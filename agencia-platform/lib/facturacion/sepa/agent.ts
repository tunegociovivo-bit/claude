/**
 * Cola de TRABAJOS BANCARIOS + agente local (fase 2).
 *
 * Reglas de oro (invariantes de seguridad):
 *  - El agente NUNCA firma, confirma en firme ni cobra. Solo prepara y deja la
 *    remesa PENDIENTE DE FIRMA (PREPARED_PENDING_SIGNATURE).
 *  - El HUB no maneja credenciales bancarias (usuario/contraseña/OTP/cookies).
 *  - Cada trabajo lleva los datos AUTORIZADOS exactos (factura, cliente, importe,
 *    fecha); el agente debe verificar que coinciden en pantalla o pausar.
 *  - Aprobación de un solo uso (unique remittanceRequestId + idempotencyKey).
 *  - Claim atómico con lease → sin doble ejecución. Kill switch por workspace.
 */
import { prisma } from "@/lib/db/prisma";
import { generateApprovalToken, hashToken, safeEqualHex } from "./token";
import { notifyJobEmail } from "./remittance";

async function jobEmailData(workspaceId: string, jobId: string) {
  const j = await prisma.remittanceJob.findFirst({ where: { id: jobId, workspaceId }, select: { clientName: true, invoiceNumber: true, amountCents: true, currency: true } });
  return j ? { clientName: j.clientName, invoiceNumber: j.invoiceNumber, amountCents: j.amountCents, currency: j.currency } : null;
}

/**
 * Saneado SERVIDOR de texto enviado por el agente antes de persistir (segunda
 * barrera: el agente ya sanea sus logs locales, pero no confiamos en la entrada).
 * Redacta IBAN completos, secuencias largas de dígitos y tokens/cookies/OTP.
 */
function serverSanitize(input: unknown, max: number): string {
  let s = typeof input === "string" ? input : String(input ?? "");
  s = s.replace(/\b([A-Z]{2})\d{2}[ ]?(?:\d[ ]?){6,30}\b/g, (m) => {
    const d = m.replace(/\s/g, "");
    return `${d.slice(0, 2)}**…**${d.slice(-4)}`;
  });
  s = s.replace(/\b\d{9,}\b/g, "«núm-redactado»");
  s = s.replace(/(authorization|cookie|set-cookie|token|password|otp|clave|contrase[nñ]a)\s*[:=]\s*\S+/gi, "$1: «redactado»");
  return s.slice(0, max);
}

export const LEASE_MS = 5 * 60 * 1000; // 5 min de arrendamiento por claim
export const ONLINE_WINDOW_MS = 90 * 1000; // agente "online" si latió en 90s

// ---- Kill switch / habilitación del agente (por workspace, OFF por defecto) ----
export async function isAgentClaimingEnabled(workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  return (ws?.settings as any)?.facturacion?.sepaAgentEnabled === true;
}
export async function setAgentClaimingEnabled(workspaceId: string, enabled: boolean): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  settings.facturacion = settings.facturacion ?? {};
  settings.facturacion.sepaAgentEnabled = enabled;
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
}

// ---- Enrolamiento / revocación (admin) ----
export async function enrollAgent(workspaceId: string, name: string, createdById?: string | null): Promise<{ agentId: string; token: string }> {
  const { token, tokenHash } = generateApprovalToken();
  const agent = await prisma.bankAgent.create({
    data: { workspaceId, name: name.trim() || "Agente", tokenHash, status: "ACTIVE", createdById: createdById ?? null },
    select: { id: true }
  });
  return { agentId: agent.id, token }; // el token se muestra UNA vez; en BD solo el hash
}
export async function revokeAgent(workspaceId: string, agentId: string): Promise<void> {
  await prisma.bankAgent.updateMany({ where: { id: agentId, workspaceId }, data: { status: "REVOKED", revokedAt: new Date() } });
}
export async function listAgents(workspaceId: string) {
  const rows = await prisma.bankAgent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, version: true, platform: true, lastHeartbeatAt: true, createdAt: true, revokedAt: true }
  });
  const now = Date.now();
  return rows.map((a) => ({ ...a, online: a.status === "ACTIVE" && !!a.lastHeartbeatAt && now - a.lastHeartbeatAt.getTime() < ONLINE_WINDOW_MS }));
}

/** Autentica al agente por su Bearer token (hash). Devuelve el agente ACTIVE o null. */
export async function authenticateAgent(bearer: string): Promise<{ id: string; workspaceId: string } | null> {
  const token = (bearer || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const th = hashToken(token);
  const agent = await prisma.bankAgent.findUnique({ where: { tokenHash: th }, select: { id: true, workspaceId: true, status: true, tokenHash: true } });
  if (!agent || agent.status !== "ACTIVE" || !safeEqualHex(agent.tokenHash, th)) return null;
  return { id: agent.id, workspaceId: agent.workspaceId };
}

export async function agentHeartbeat(agentId: string, meta?: { version?: string; platform?: string }): Promise<void> {
  await prisma.bankAgent.update({
    where: { id: agentId },
    data: { lastHeartbeatAt: new Date(), version: meta?.version ?? undefined, platform: meta?.platform ?? undefined }
  });
}

async function logJob(jobId: string, from: string | null, to: string, opts?: { agentId?: string | null; userId?: string | null; note?: string }) {
  await prisma.remittanceJobEvent.create({
    data: { jobId, fromStatus: from, toStatus: to, agentId: opts?.agentId ?? null, userId: opts?.userId ?? null, note: opts?.note ?? null }
  });
}

/**
 * Crea (idempotente) el trabajo bancario para una solicitud APROBADA, vinculando
 * los datos autorizados. Se llama al aprobar. Un solo trabajo por remesa.
 */
export async function createJobForApprovedRequest(workspaceId: string, remittanceRequestId: string): Promise<{ created: boolean; jobId: string } | null> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SepaRemittanceRequest" WHERE "id" = ${remittanceRequestId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
      const req = await tx.sepaRemittanceRequest.findFirst({
        where: { id: remittanceRequestId, workspaceId, status: "APPROVED", archivedAt: null },
        select: { id: true, companyId: true, invoiceId: true, clientId: true, invoiceNumber: true, clientName: true, amountCents: true, currency: true, mandateRef: true, ibanMasked: true }
      });
      if (!req) return null;
      const existing = await tx.remittanceJob.findUnique({ where: { remittanceRequestId }, select: { id: true } });
      if (existing) return { created: false, jobId: existing.id };
      const job = await tx.remittanceJob.create({
        data: {
        workspaceId,
        remittanceRequestId,
        invoiceId: req.invoiceId,
        clientId: req.clientId,
        companyId: req.companyId,
        status: "PENDING",
        invoiceNumber: req.invoiceNumber,
        clientName: req.clientName,
        amountCents: req.amountCents,
        currency: req.currency,
        mandateRef: req.mandateRef,
        ibanMasked: req.ibanMasked,
        idempotencyKey: `sepa-job:${remittanceRequestId}`
        },
        select: { id: true }
      });
      return { created: true, jobId: job.id };
    });
    if (result?.created) await logJob(result.jobId, null, "PENDING", { note: "Trabajo creado tras aprobación" });
    return result;
  } catch (e: any) {
    if (e?.code === "P2002") {
      const ex = await prisma.remittanceJob.findUnique({ where: { remittanceRequestId }, select: { id: true } });
      if (ex) return { created: false, jobId: ex.id };
    }
    throw e;
  }
}

export type ClaimedJob = {
  jobId: string;
  invoiceNumber: string | null;
  clientName: string;
  amountCents: number;
  currency: string;
  mandateRef: string | null;
  ibanMasked: string | null;
  santanderTemplate: string | null;
  leaseUntil: string;
};

/**
 * El agente reclama el siguiente trabajo PENDING (si el claiming está habilitado).
 * Claim ATÓMICO con lease → imposible doble ejecución. Devuelve SOLO datos
 * autorizados (sin secretos). null si no hay trabajo o el claiming está apagado.
 */
export async function claimNextJob(agentId: string, workspaceId: string): Promise<ClaimedJob | null> {
  if (!(await isAgentClaimingEnabled(workspaceId))) return null; // kill switch / OFF por defecto
  const now = new Date();
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = await prisma.remittanceJob.findFirst({
      where: { workspaceId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, remittanceRequestId: true }
    });
    if (!candidate) return null;
    const visibleRequest = await prisma.sepaRemittanceRequest.count({
      where: { id: candidate.remittanceRequestId, workspaceId, archivedAt: null }
    });
    if (visibleRequest === 0) {
      await prisma.remittanceJob.updateMany({
        where: { id: candidate.id, workspaceId, status: "PENDING" },
        data: { status: "CANCELLED", leaseUntil: null }
      });
      continue;
    }
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const upd = await prisma.remittanceJob.updateMany({
      where: { id: candidate.id, workspaceId, status: "PENDING" },
      data: { status: "CLAIMED", claimedByAgentId: agentId, leaseUntil, attempts: { increment: 1 } }
    });
    if (upd.count === 1) {
      await logJob(candidate.id, "PENDING", "CLAIMED", { agentId, note: "Reclamado por el agente" });
      const job = await prisma.remittanceJob.findUnique({
        where: { id: candidate.id },
        select: { id: true, clientId: true, invoiceNumber: true, clientName: true, amountCents: true, currency: true, mandateRef: true, ibanMasked: true, leaseUntil: true }
      });
      if (!job) return null;
      const client = await prisma.client.findFirst({
        where: { id: job.clientId, workspaceId, deletedAt: null },
        select: { sepaSantanderTemplate: true }
      });
      return {
        jobId: job.id, invoiceNumber: job.invoiceNumber, clientName: job.clientName, amountCents: job.amountCents,
        currency: job.currency, mandateRef: job.mandateRef, ibanMasked: job.ibanMasked,
        santanderTemplate: client?.sepaSantanderTemplate ?? null,
        leaseUntil: job.leaseUntil!.toISOString()
      };
    }
    // otro agente ganó → reintenta con el siguiente
  }
  return null;
}

/** Verifica que el trabajo sigue arrendado por este agente (anti doble ejecución). */
async function assertLeased(jobId: string, agentId: string, workspaceId: string) {
  const job = await prisma.remittanceJob.findFirst({ where: { id: jobId, workspaceId }, select: { id: true, status: true, claimedByAgentId: true, leaseUntil: true } });
  if (!job) throw new Error("Trabajo no encontrado");
  if (job.claimedByAgentId !== agentId) throw new Error("El trabajo no está arrendado por este agente");
  if (!job.leaseUntil || job.leaseUntil.getTime() < Date.now()) throw new Error("Lease caducado");
  return job;
}

/** Progreso del agente: RUNNING (con lease renovado) o NEEDS_USER (pausa por intervención). */
export async function reportProgress(agentId: string, workspaceId: string, jobId: string, opts: { state: "RUNNING" | "NEEDS_USER"; progress?: string; reason?: string }): Promise<{ ok: true }> {
  const job = await assertLeased(jobId, agentId, workspaceId);
  const now = new Date();
  const data: any = { lastProgress: serverSanitize(opts.progress ?? "", 300) };
  if (opts.state === "RUNNING") {
    data.status = "RUNNING";
    data.leaseUntil = new Date(Date.now() + LEASE_MS); // renueva lease
  } else {
    data.status = "NEEDS_USER";
    data.needsUserReason = serverSanitize(opts.reason ?? "Intervención requerida", 500);
  }
  const updated = await prisma.remittanceJob.updateMany({
    where: {
      id: jobId,
      workspaceId,
      claimedByAgentId: agentId,
      status: { in: ["CLAIMED", "RUNNING", "NEEDS_USER"] },
      leaseUntil: { gt: now }
    },
    data
  });
  if (updated.count !== 1) throw new Error("El trabajo ya no está activo o fue cancelado");
  await logJob(jobId, job.status, data.status, { agentId, note: opts.state === "NEEDS_USER" ? `NEEDS_USER: ${data.needsUserReason}` : data.lastProgress });
  if (opts.state === "NEEDS_USER") {
    const d = await jobEmailData(workspaceId, jobId);
    if (d) await notifyJobEmail("needs_user", { ...d, reason: data.needsUserReason }).catch(() => {});
  }
  return { ok: true };
}

export type CompleteInput =
  | { result: "PREPARED_PENDING_SIGNATURE"; verifiedPendingSignature: true; resultRef?: string }
  | { result: "FAILED"; error?: string };

/**
 * Cierre del trabajo. PREPARED_PENDING_SIGNATURE exige que el agente ASEVERE que
 * verificó VISUALMENTE el estado "pendiente de firma" (verifiedPendingSignature).
 * Transición atómica (leased por este agente). Nunca implica firma ni cobro.
 */
export async function completeJob(agentId: string, workspaceId: string, jobId: string, input: CompleteInput): Promise<{ ok: true; status: string }> {
  const job = await assertLeased(jobId, agentId, workspaceId);

  if (input.result === "PREPARED_PENDING_SIGNATURE") {
    if (input.verifiedPendingSignature !== true) throw new Error("Falta verificación visible del estado pendiente de firma");
    // Kill switch como parada de emergencia también en vuelo: si se apagó tras el
    // claim, no se permite finalizar. El lease caducará y el cron re-encolará;
    // mientras el switch siga OFF, no se volverá a entregar.
    if (!(await isAgentClaimingEnabled(workspaceId))) throw new Error("Agente pausado (kill switch): no se puede finalizar la preparación");
    const now = new Date();
    const upd = await prisma.remittanceJob.updateMany({
      where: { id: jobId, workspaceId, claimedByAgentId: agentId, status: { in: ["CLAIMED", "RUNNING", "NEEDS_USER"] }, leaseUntil: { gt: now } },
      data: { status: "PREPARED_PENDING_SIGNATURE", resultRef: (input.resultRef ?? "").slice(0, 120) || null, chargeDate: now, claimedByAgentId: null, leaseUntil: null }
    });
    if (upd.count === 0) throw new Error("No se pudo cerrar (lease caducado o ya cerrado)");
    await logJob(jobId, job.status, "PREPARED_PENDING_SIGNATURE", { agentId, note: "Preparada y verificada como pendiente de firma (sin firmar ni cobrar)" });
    // Refleja en la solicitud: PENDING_SIGNATURE + fecha de cobro (inmediata al preparar).
    await prisma.sepaRemittanceRequest.updateMany({
      where: { id: (await requestIdOfJob(workspaceId, jobId)) ?? "", workspaceId },
      data: { status: "PENDING_SIGNATURE", chargeDate: now }
    });
    const d = await jobEmailData(workspaceId, jobId);
    if (d) await notifyJobEmail("pending_signature", d).catch(() => {});
    return { ok: true, status: "PREPARED_PENDING_SIGNATURE" };
  }

  // FAILED
  const failMsg = serverSanitize(input.error ?? "Error del agente", 500);
  const upd = await prisma.remittanceJob.updateMany({
    where: {
      id: jobId,
      workspaceId,
      claimedByAgentId: agentId,
      status: { in: ["CLAIMED", "RUNNING", "NEEDS_USER"] },
      leaseUntil: { gt: new Date() }
    },
    data: { status: "FAILED", lastError: failMsg, claimedByAgentId: null, leaseUntil: null }
  });
  if (upd.count === 0) throw new Error("No se pudo marcar como fallido");
  await logJob(jobId, job.status, "FAILED", { agentId, note: failMsg.slice(0, 300) });
  return { ok: true, status: "FAILED" };
}

async function requestIdOfJob(workspaceId: string, jobId: string): Promise<string | null> {
  const j = await prisma.remittanceJob.findFirst({ where: { id: jobId, workspaceId }, select: { remittanceRequestId: true } });
  return j?.remittanceRequestId ?? null;
}

/** Re-encola trabajos con lease caducado (agente caído). FAILED si se agotan intentos. */
export async function reclaimExpiredLeases(workspaceId: string): Promise<{ requeued: number; failed: number }> {
  const now = new Date();
  const stale = await prisma.remittanceJob.findMany({
    where: { workspaceId, status: { in: ["CLAIMED", "RUNNING", "NEEDS_USER"] }, leaseUntil: { lt: now } },
    select: { id: true, status: true, attempts: true, maxAttempts: true }
  });
  let requeued = 0;
  let failed = 0;
  for (const j of stale) {
    if (j.attempts >= j.maxAttempts) {
      const updated = await prisma.remittanceJob.updateMany({
        where: { id: j.id, workspaceId, status: j.status, leaseUntil: { lt: now } },
        data: { status: "FAILED", lastError: "Lease caducado; agotados los intentos", claimedByAgentId: null, leaseUntil: null }
      });
      if (updated.count !== 1) continue;
      await logJob(j.id, j.status, "FAILED", { note: "Lease caducado, sin reintentos" });
      failed++;
    } else {
      const updated = await prisma.remittanceJob.updateMany({
        where: { id: j.id, workspaceId, status: j.status, leaseUntil: { lt: now } },
        data: { status: "PENDING", claimedByAgentId: null, leaseUntil: null }
      });
      if (updated.count !== 1) continue;
      await logJob(j.id, j.status, "PENDING", { note: "Re-encolado (lease caducado)" });
      requeued++;
    }
  }
  return { requeued, failed };
}

/** Admin: reintentar (a PENDING) un trabajo FAILED/CANCELLED. */
export async function retryJob(workspaceId: string, jobId: string, userId?: string | null): Promise<void> {
  const previousStatus = await prisma.$transaction(async (tx) => {
    const job = await tx.remittanceJob.findFirst({ where: { id: jobId, workspaceId }, select: { id: true, status: true, remittanceRequestId: true } });
    if (!job) throw new Error("Trabajo no encontrado");
    await tx.$queryRaw`SELECT "id" FROM "SepaRemittanceRequest" WHERE "id" = ${job.remittanceRequestId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
    const visibleRequest = await tx.sepaRemittanceRequest.count({ where: { id: job.remittanceRequestId, workspaceId, archivedAt: null } });
    if (visibleRequest === 0) throw new Error("No se puede reintentar una solicitud eliminada");
    if (!["FAILED", "CANCELLED", "NEEDS_USER"].includes(job.status)) throw new Error("Solo se reintentan trabajos fallidos/cancelados/en pausa");
    const updated = await tx.remittanceJob.updateMany({
      where: { id: jobId, workspaceId, status: { in: ["FAILED", "CANCELLED", "NEEDS_USER"] } },
      data: { status: "PENDING", claimedByAgentId: null, leaseUntil: null, attempts: 0, lastError: null, needsUserReason: null }
    });
    if (updated.count !== 1) throw new Error("El trabajo cambió mientras se reintentaba");
    return job.status;
  });
  await logJob(jobId, previousStatus, "PENDING", { userId, note: "Reintento manual (admin)" });
}

/** Admin: cancelar un trabajo (si no está ya preparado/pendiente de firma). */
export async function cancelJob(workspaceId: string, jobId: string, userId?: string | null): Promise<void> {
  const job = await prisma.remittanceJob.findFirst({ where: { id: jobId, workspaceId }, select: { id: true, status: true } });
  if (!job) throw new Error("Trabajo no encontrado");
  if (job.status === "PREPARED_PENDING_SIGNATURE") throw new Error("No se cancela un trabajo ya pendiente de firma");
  const updated = await prisma.remittanceJob.updateMany({
    where: { id: jobId, workspaceId, status: { in: ["PENDING", "CLAIMED", "RUNNING", "NEEDS_USER", "FAILED", "CANCELLED"] } },
    data: { status: "CANCELLED", claimedByAgentId: null, leaseUntil: null }
  });
  if (updated.count !== 1) throw new Error("El trabajo cambió mientras se cancelaba");
  await logJob(jobId, job.status, "CANCELLED", { userId, note: "Cancelado (admin)" });
}

const DELETABLE_BANK_JOB_STATUSES = new Set(["PENDING", "NEEDS_USER", "FAILED", "CANCELLED"]);

export function canDeleteBankJobStatus(status: string): boolean {
  return DELETABLE_BANK_JOB_STATUSES.has(status);
}

/** Admin: elimina definitivamente un trabajo inactivo y sus eventos de auditoría. */
export async function deleteJob(workspaceId: string, jobId: string): Promise<void> {
  const job = await prisma.remittanceJob.findFirst({
    where: { id: jobId, workspaceId },
    select: { id: true, status: true }
  });
  if (!job) throw new Error("Trabajo no encontrado");
  if (!canDeleteBankJobStatus(job.status)) {
    throw new Error("Solo se eliminan trabajos en cola, en pausa, fallidos o cancelados");
  }
  const deleted = await prisma.remittanceJob.deleteMany({
    where: { id: jobId, workspaceId, status: { in: [...DELETABLE_BANK_JOB_STATUSES] as any } }
  });
  if (deleted.count !== 1) throw new Error("El trabajo cambió mientras se eliminaba");
}

/** Listado de trabajos (paginado) para la UI admin. */
export async function listJobs(workspaceId: string, opts?: { status?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(opts?.pageSize ?? 25, 100);
  const where: any = { workspaceId };
  if (opts?.status) where.status = opts.status;
  const [items, total] = await Promise.all([
    prisma.remittanceJob.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, status: true, invoiceNumber: true, clientName: true, amountCents: true, currency: true, ibanMasked: true, attempts: true, lastProgress: true, needsUserReason: true, lastError: true, resultRef: true, chargeDate: true, createdAt: true, updatedAt: true }
    }),
    prisma.remittanceJob.count({ where })
  ]);
  return { items, total, page, pageSize };
}

/** Eventos (log saneado) de un trabajo. */
export async function jobEvents(workspaceId: string, jobId: string) {
  const job = await prisma.remittanceJob.findFirst({ where: { id: jobId, workspaceId }, select: { id: true } });
  if (!job) return [];
  return prisma.remittanceJobEvent.findMany({ where: { jobId }, orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, note: true, createdAt: true, agentId: true } });
}
