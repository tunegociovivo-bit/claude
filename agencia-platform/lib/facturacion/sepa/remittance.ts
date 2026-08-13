/**
 * Servicio de remesas de adeudos SEPA (SOLO Negocio Vivo S.C.A.).
 *
 * Flujo: detectar factura candidata → crear solicitud idempotente (una por
 * empresa+factura) → email a info@negociovivo.com con enlace seguro → un usuario
 * autenticado y autorizado aprueba/rechaza desde /facturacion/aprobaciones/[token]
 * (token de un solo uso, hash en BD, caducidad 24 h, transición atómica) → queda
 * lista para preparar en Santander (integración pendiente) y luego pendiente de
 * firma. APROBAR NO FIRMA NI COBRA.
 */
import { prisma } from "@/lib/db/prisma";
import { sendEmail, isEmailEnabled } from "@/lib/integrations/email";
import { generateApprovalToken, hashToken, safeEqualHex, TOKEN_TTL_MS } from "./token";
import { evaluateCandidacy, NEGOCIO_VIVO_ISSUER_NAME } from "./candidates";
import { getSantanderProviderStatus } from "./santander-provider";
import { madridBusinessDayWindow } from "./recency";

/** Destinatario del email de aprobación (configurable). */
function approvalRecipient(): string {
  return process.env.SEPA_APPROVAL_EMAIL || "info@negociovivo.com";
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://hub.negociovivo.app").replace(/\/$/, "");
}

/** Emisora Negocio Vivo del workspace (o null). */
export async function getNegocioVivoIssuer(workspaceId: string): Promise<{ id: string; name: string } | null> {
  const issuers = await prisma.invoiceIssuer.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, name: true }
  });
  const nv = issuers.find((i) => i.name.toLowerCase().trim() === NEGOCIO_VIVO_ISSUER_NAME.toLowerCase().trim());
  return nv ?? null;
}

export type CandidateInvoice = {
  invoiceId: string;
  number: string | null;
  clientId: string | null;
  clientName: string;
  amountCents: number;
  currency: string;
  issueDate: Date;
  eligible: boolean;
  reasons: string[];
};

/**
 * Lista facturas candidatas (paginado, sin traer las 300+ completas). Aplica los
 * filtros duros en BD y `evaluateCandidacy` como guarda final.
 */
export async function findCandidateInvoices(
  workspaceId: string,
  opts?: { take?: number; skip?: number; issuedAfter?: Date; issuedBefore?: Date; invoiceIds?: string[] }
): Promise<CandidateInvoice[]> {
  const nv = await getNegocioVivoIssuer(workspaceId);
  if (!nv) return [];
  const take = Math.min(opts?.take ?? 100, 300);
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const excludedNumbers = new Set<string>(
    (((workspace?.settings as any)?.facturacion?.sepaExcludedInvoiceNumbers ?? []) as string[])
      .map((number) => number.trim().toLowerCase())
  );

  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId,
      issuerId: nv.id,
      deletedAt: null,
      type: "NORMAL", // solo facturas fiscales normales (no proforma/presupuesto/rectificativa)
      status: "ISSUED",
      totalCents: { gt: 0 },
      paidAt: null,
      clientId: { not: null },
      number: { not: null },
      NOT: { number: { startsWith: "R-", mode: "insensitive" } },
      ...(opts?.invoiceIds ? { id: { in: opts.invoiceIds } } : {}),
      ...((opts?.issuedAfter || opts?.issuedBefore)
        ? { issueDate: { ...(opts.issuedAfter ? { gte: opts.issuedAfter } : {}), ...(opts.issuedBefore ? { lt: opts.issuedBefore } : {}) } }
        : {})
    },
    orderBy: { issueDate: "desc" },
    take,
    skip: opts?.skip ?? 0,
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      totalCents: true,
      paidCents: true,
      paidAt: true,
      currency: true,
      issueDate: true,
      clientId: true,
      client: { select: { id: true, name: true, sepaEnabled: true } }
    }
  });

  if (invoices.length === 0) return [];

  // ¿Cuáles ya tienen solicitud? (una query, no N+1)
  const existing = await prisma.sepaRemittanceRequest.findMany({
    where: { workspaceId, invoiceId: { in: invoices.map((i) => i.id) } },
    select: { invoiceId: true }
  });
  const withRequest = new Set(existing.map((e) => e.invoiceId));

  return invoices.map((inv) => {
    const c = evaluateCandidacy({
      issuerName: nv.name,
      status: inv.status,
      type: inv.type,
      number: inv.number,
      totalCents: inv.totalCents,
      paidCents: inv.paidCents,
      paidAt: inv.paidAt,
      clientId: inv.clientId,
      clientSepaEnabled: inv.client?.sepaEnabled ?? false,
      hasExistingRequest: withRequest.has(inv.id),
      manuallyExcluded: excludedNumbers.has((inv.number ?? "").trim().toLowerCase())
    });
    return {
      invoiceId: inv.id,
      number: inv.number,
      clientId: inv.clientId,
      clientName: inv.client?.name ?? "",
      amountCents: inv.totalCents,
      currency: inv.currency,
      issueDate: inv.issueDate,
      eligible: c.eligible,
      reasons: c.reasons
    };
  });
}

async function logEvent(requestId: string, from: string | null, to: string, userId?: string | null, note?: string, error?: string) {
  await prisma.sepaRemittanceEvent.create({
    data: { requestId, fromStatus: from, toStatus: to, userId: userId ?? null, note: note ?? null, error: error ?? null }
  });
}

/**
 * Crea (idempotente) la solicitud de remesa para una factura candidata y envía el
 * email de aprobación. Idempotencia por (workspaceId, companyId, invoiceId).
 */
export async function createRequestForInvoice(
  workspaceId: string,
  invoiceId: string,
  createdById?: string | null
): Promise<{ created: boolean; requestId: string }> {
  const nv = await getNegocioVivoIssuer(workspaceId);
  if (!nv) throw new Error("No existe la empresa emisora Negocio Vivo S.C.A. en este workspace.");

  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, workspaceId, deletedAt: null },
    select: {
      id: true, number: true, type: true, status: true, totalCents: true, paidCents: true, paidAt: true,
      currency: true, issuerId: true, clientId: true,
      client: { select: { id: true, name: true, sepaEnabled: true, sepaMandateRef: true, sepaIbanMasked: true } }
    }
  });
  if (!inv) throw new Error("Factura no encontrada.");
  if (inv.issuerId !== nv.id) throw new Error("La factura no es de Negocio Vivo S.C.A.");
  if (/^R-/i.test(inv.number?.trim() ?? "") || inv.type === "RECTIFICATIVA") {
    throw new Error("Las facturas rectificativas nunca se incluyen en remesas.");
  }
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const excludedNumbers = (((workspace?.settings as any)?.facturacion?.sepaExcludedInvoiceNumbers ?? []) as string[])
    .map((number) => number.trim().toLowerCase());

  const c = evaluateCandidacy({
    issuerName: nv.name,
    status: inv.status,
    type: inv.type,
    number: inv.number,
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    paidAt: inv.paidAt,
    clientId: inv.clientId,
    clientSepaEnabled: inv.client?.sepaEnabled ?? false,
    hasExistingRequest: false,
    manuallyExcluded: excludedNumbers.includes((inv.number ?? "").trim().toLowerCase())
  });
  if (!c.eligible) throw new Error(`La factura no es candidata: ${c.reasons.join("; ")}`);

  const { token, tokenHash } = generateApprovalToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // ¿Ya existe una solicitud para esta factura? (unique companyId+invoiceId)
  const prev = await prisma.sepaRemittanceRequest.findUnique({
    where: { workspaceId_companyId_invoiceId: { workspaceId, companyId: nv.id, invoiceId } },
    select: { id: true, status: true }
  });
  if (prev) {
    // Solo re-armamos las caducadas/fallidas (nuevo enlace); el resto es idempotente
    // (una decidida/pendiente/aprobada NO se recrea; una RECHAZADA se respeta).
    if (prev.status === "EXPIRED" || prev.status === "FAILED") {
      await prisma.sepaRemittanceRequest.update({
        where: { id: prev.id },
        data: {
          status: "PENDING_APPROVAL",
          tokenHash,
          tokenExpiresAt: expiresAt,
          tokenUsedAt: null,
          amountCents: inv.totalCents,
          mandateRef: inv.client?.sepaMandateRef ?? null,
          ibanMasked: inv.client?.sepaIbanMasked ?? null,
          providerStatus: getSantanderProviderStatus(),
          lastError: null
        }
      });
      await logEvent(prev.id, prev.status, "PENDING_APPROVAL", createdById, "Solicitud re-armada (nuevo enlace)");
      await notifyApproval(prev.id, token, inv, createdById);
      return { created: true, requestId: prev.id };
    }
    return { created: false, requestId: prev.id };
  }

  let requestId: string;
  try {
    const req = await prisma.sepaRemittanceRequest.create({
      data: {
        workspaceId,
        companyId: nv.id,
        invoiceId: inv.id,
        clientId: inv.clientId!,
        status: "PENDING_APPROVAL",
        companyName: nv.name,
        clientName: inv.client?.name ?? "",
        invoiceNumber: inv.number,
        amountCents: inv.totalCents,
        currency: inv.currency,
        mandateRef: inv.client?.sepaMandateRef ?? null,
        ibanMasked: inv.client?.sepaIbanMasked ?? null,
        tokenHash,
        tokenExpiresAt: expiresAt,
        providerStatus: getSantanderProviderStatus(),
        createdById: createdById ?? null
      },
      select: { id: true }
    });
    requestId = req.id;
  } catch (e: any) {
    // Carrera: otra creación simultánea ganó → devolvemos la existente.
    if (e?.code === "P2002") {
      const ex = await prisma.sepaRemittanceRequest.findUnique({
        where: { workspaceId_companyId_invoiceId: { workspaceId, companyId: nv.id, invoiceId } },
        select: { id: true }
      });
      if (ex) return { created: false, requestId: ex.id };
    }
    throw e;
  }

  await logEvent(requestId, null, "PENDING_APPROVAL", createdById, "Solicitud creada");
  await notifyApproval(requestId, token, inv, createdById);
  return { created: true, requestId };
}

/**
 * Envía el email de aprobación y AUDITA el resultado (enviado / RESEND
 * desactivado / error), para que siempre haya traza de por qué llegó o no.
 */
async function notifyApproval(requestId: string, token: string, inv: any, createdById?: string | null): Promise<void> {
  if (!isEmailEnabled()) {
    await logEvent(requestId, "PENDING_APPROVAL", "PENDING_APPROVAL", createdById, "Email NO enviado: RESEND no configurado");
    return;
  }
  try {
    await sendApprovalEmail({
      to: approvalRecipient(),
      token,
      clientName: inv.client?.name ?? "",
      invoiceNumber: inv.number,
      amountCents: inv.totalCents,
      currency: inv.currency
    });
    await logEvent(requestId, "PENDING_APPROVAL", "PENDING_APPROVAL", createdById, `Email de aprobación enviado a ${approvalRecipient()}`);
  } catch (err: any) {
    await logEvent(requestId, "PENDING_APPROVAL", "PENDING_APPROVAL", createdById, "Fallo al enviar email", String(err?.message ?? err));
  }
}

/** Crea solicitudes para todas las candidatas elegibles (acotado). */
export async function createRequestsForCandidates(
  workspaceId: string,
  createdById?: string | null,
  opts?: { max?: number; issuedAfter?: Date; issuedBefore?: Date; invoiceIds?: string[] }
): Promise<{ created: number; skipped: number; examined: number; eligible: number; invalidated: number; requestIds: string[] }> {
  const max = Math.min(opts?.max ?? 50, 200);
  // Defensa central: ningún caller puede omitir por accidente el límite de
  // fecha y volver a convertir una importación histórica en remesa nueva.
  const defaultWindow = madridBusinessDayWindow();
  const issuedAfter = opts?.issuedAfter ?? defaultWindow.start;
  const issuedBefore = opts?.issuedBefore ?? defaultWindow.end;
  const invalidated = await invalidateKnownFalseHistoricalRequests(workspaceId, createdById);
  const all = await findCandidateInvoices(workspaceId, { take: 300, issuedAfter, issuedBefore, invoiceIds: opts?.invoiceIds });
  const eligible = all.filter((c) => c.eligible).slice(0, max);
  let created = 0;
  let skipped = 0;
  const requestIds: string[] = [];
  for (const cand of eligible) {
    try {
      const r = await createRequestForInvoice(workspaceId, cand.invoiceId, createdById);
      if (r.created) {
        created++;
        requestIds.push(r.requestId);
      }
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { created, skipped, examined: all.length, eligible: eligible.length, invalidated, requestIds };
}

/** Aprobación interna para el piloto automático. Nunca firma ni cobra. */
export async function approveRequestAutomatically(workspaceId: string, requestId: string): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.sepaRemittanceRequest.updateMany({
    where: { id: requestId, workspaceId, status: "PENDING_APPROVAL", tokenUsedAt: null },
    data: { status: "APPROVED", tokenUsedAt: now, approvedAt: now }
  });
  if (!updated.count) return false;
  await logEvent(requestId, "PENDING_APPROVAL", "APPROVED", null, "Aprobada automáticamente por el cron (no firma ni cobra)");
  const { createJobForApprovedRequest } = await import("./agent");
  await createJobForApprovedRequest(workspaceId, requestId);
  return true;
}

// Incidente confirmado el 10/08/2026. La limpieza se limita a estas dos
// solicitudes concretas para no invalidar remesas históricas deliberadas.
const KNOWN_FALSE_HISTORICAL_REQUESTS = [
  { invoiceNumber: "FAC-003005", clientName: "2M2 ROPA DE TRABAJO, S.L.", amountCents: 24200 },
  { invoiceNumber: "FAC-002859", clientName: "Chuthatip Soichampa", amountCents: 14520 }
] as const;

// Ventana del incidente conocido. Es deliberadamente finita: esta limpieza no
// debe convertirse en una regla permanente para facturas históricas legítimas.
const FALSE_IMPORT_INCIDENT_START = new Date("2026-08-09T22:00:00.000Z");
const FALSE_IMPORT_INCIDENT_END = new Date("2026-08-10T22:00:00.000Z");

async function invalidateKnownFalseHistoricalRequests(
  workspaceId: string,
  userId?: string | null
): Promise<number> {
  const pending = await prisma.sepaRemittanceRequest.findMany({
    where: {
        workspaceId,
        status: "PENDING_APPROVAL",
        createdAt: { gte: FALSE_IMPORT_INCIDENT_START, lt: FALSE_IMPORT_INCIDENT_END },
        OR: KNOWN_FALSE_HISTORICAL_REQUESTS.map((item) => ({
          invoiceNumber: { equals: item.invoiceNumber, mode: "insensitive" as const },
          clientName: { equals: item.clientName, mode: "insensitive" as const },
          amountCents: item.amountCents
        }))
    },
    select: { id: true }
  });
  let invalidated = 0;
  for (const request of pending) {
    const now = new Date();
    const result = await prisma.sepaRemittanceRequest.updateMany({
      where: { id: request.id, workspaceId, status: "PENDING_APPROVAL" },
      data: {
        status: "REJECTED",
        rejectedAt: now,
        rejectedById: userId ?? null,
        rejectReason: "Factura histórica importada hoy; no fue emitida en la fecha del escaneo.",
        tokenUsedAt: now
      }
    });
    if (result.count === 1) {
      invalidated++;
      await logEvent(
        request.id,
        "PENDING_APPROVAL",
        "REJECTED",
        userId,
        "Invalidada automáticamente: fecha de emisión anterior al día del escaneo"
      );
    }
  }
  return invalidated;
}

function fmtAmount(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

async function sendApprovalEmail(opts: {
  to: string;
  token: string;
  clientName: string;
  invoiceNumber: string | null;
  amountCents: number;
  currency: string;
}): Promise<void> {
  if (!isEmailEnabled()) return; // sin Resend no se envía (queda registrado por el llamador)
  const link = `${baseUrl()}/facturacion/aprobaciones/${encodeURIComponent(opts.token)}`;
  const amount = fmtAmount(opts.amountCents, opts.currency);
  const subject = `Aprobar remesa SEPA · ${opts.clientName} · ${amount}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
    <p>Hay una remesa de adeudo SEPA pendiente de aprobación:</p>
    <ul>
      <li><strong>Cliente:</strong> ${escapeHtml(opts.clientName)}</li>
      <li><strong>Factura:</strong> ${escapeHtml(opts.invoiceNumber ?? "—")}</li>
      <li><strong>Importe:</strong> ${amount}</li>
    </ul>
    <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Revisar y aprobar</a></p>
    <p style="font-size:12px;color:#888">Este enlace es de un solo uso y caduca en 24 horas. Requiere iniciar sesión. Aprobar NO ejecuta el cobro.</p>
  </div>`;
  const text = `Remesa SEPA pendiente de aprobación.\nCliente: ${opts.clientName}\nFactura: ${opts.invoiceNumber ?? "—"}\nImporte: ${amount}\nRevisar (un solo uso, caduca en 24h, requiere login): ${link}\nAprobar NO ejecuta el cobro.`;
  await sendEmail({ to: opts.to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * Emails del ciclo del TRABAJO bancario (fase 2). SANEADOS: nunca datos bancarios
 * ni credenciales. Best-effort (no rompe el flujo si falla o si RESEND está off).
 */
export async function notifyJobEmail(
  kind: "created" | "needs_user" | "pending_signature",
  data: { clientName: string; invoiceNumber: string | null; amountCents: number; currency: string; reason?: string }
): Promise<void> {
  if (!isEmailEnabled()) return;
  const amount = fmtAmount(data.amountCents, data.currency);
  const who = `${escapeHtml(data.clientName)} · ${escapeHtml(data.invoiceNumber ?? "—")} · ${amount}`;
  const map = {
    created: { subject: `Remesa aprobada · trabajo en cola · ${data.clientName}`, body: `La remesa ha sido aprobada y hay un trabajo bancario en cola para el agente local. No se firma ni se cobra: se dejará PENDIENTE DE FIRMA.` },
    needs_user: { subject: `⚠️ Remesa SEPA requiere intervención · ${data.clientName}`, body: `El agente ha pausado y necesita tu intervención${data.reason ? `: ${escapeHtml(data.reason)}` : ""}. Abre Santander en tu Chrome y continúa/verifica manualmente.` },
    pending_signature: { subject: `Remesa SEPA PREPARADA · pendiente de firma · ${data.clientName}`, body: `El agente ha preparado la remesa y la ha dejado PENDIENTE DE FIRMA (no la ha firmado ni cobrado). Revisa y firma tú en Santander.` }
  }[kind];
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
    <p>${map.body}</p><p><strong>${who}</strong></p>
    <p style="font-size:12px;color:#888">El agente nunca firma, confirma ni cobra. Sin datos bancarios en este email.</p></div>`;
  await sendEmail({ to: approvalRecipient(), subject: map.subject, html, text: `${map.body}\n${data.clientName} · ${data.invoiceNumber ?? "—"} · ${amount}` });
}

export type TokenLookup =
  | { ok: true; request: any }
  | { ok: false; reason: "not_found" | "used" | "expired" | "not_pending" };

/** Busca una solicitud por token (hash), validando uso/caducidad/estado. Sin cambiar estado. */
export async function getRequestByToken(workspaceId: string, token: string): Promise<TokenLookup> {
  const th = hashToken(token);
  const req = await prisma.sepaRemittanceRequest.findUnique({ where: { tokenHash: th } });
  if (!req || req.workspaceId !== workspaceId || req.archivedAt || !safeEqualHex(req.tokenHash, th)) return { ok: false, reason: "not_found" };
  if (req.tokenUsedAt) return { ok: false, reason: "used" };
  if (req.tokenExpiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (req.status !== "PENDING_APPROVAL") return { ok: false, reason: "not_pending" };
  return { ok: true, request: req };
}

export type DecisionResult =
  | { ok: true; status: "APPROVED" | "REJECTED" }
  | { ok: false; reason: "not_found" | "used" | "expired" | "already_decided" };

/**
 * Aprueba o rechaza por token. Transición ATÓMICA (updateMany con guarda por
 * estado + token no usado + no caducado) → imposible doble aprobación aunque haya
 * dos peticiones a la vez. Marca el token como usado (un solo uso) y audita.
 * APROBAR NO FIRMA NI COBRA: solo deja la solicitud APPROVED (lista para preparar).
 */
export async function decideByToken(
  workspaceId: string,
  token: string,
  opts: { action: "approve" | "reject"; userId: string; reason?: string }
): Promise<DecisionResult> {
  const th = hashToken(token);
  const req = await prisma.sepaRemittanceRequest.findUnique({ where: { tokenHash: th } });
  if (!req || req.workspaceId !== workspaceId || req.archivedAt || !safeEqualHex(req.tokenHash, th)) return { ok: false, reason: "not_found" };
  if (req.tokenUsedAt) return { ok: false, reason: "used" };
  if (req.tokenExpiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (req.status !== "PENDING_APPROVAL") return { ok: false, reason: "already_decided" };

  const now = new Date();
  const target = opts.action === "approve" ? "APPROVED" : "REJECTED";

  // Guarda atómica: solo actualiza si SIGUE pendiente y sin usar y sin caducar.
  const updated = await prisma.sepaRemittanceRequest.updateMany({
    where: { id: req.id, workspaceId, archivedAt: null, status: "PENDING_APPROVAL", tokenUsedAt: null, tokenExpiresAt: { gt: now } },
    data:
      opts.action === "approve"
        ? { status: "APPROVED", tokenUsedAt: now, approvedById: opts.userId, approvedAt: now }
        : { status: "REJECTED", tokenUsedAt: now, rejectedById: opts.userId, rejectedAt: now, rejectReason: opts.reason ?? null }
  });
  if (updated.count === 0) return { ok: false, reason: "already_decided" };

  await logEvent(req.id, "PENDING_APPROVAL", target, opts.userId, opts.action === "reject" ? opts.reason : "Aprobada (no firma ni cobra)");

  // Al APROBAR: crea el trabajo bancario (fase 2) vinculado a los datos autorizados
  // y avisa por email. NO firma ni cobra; el agente lo dejará pendiente de firma.
  if (opts.action === "approve") {
    try {
      const { createJobForApprovedRequest, setAgentClaimingEnabled } = await import("./agent");
      await createJobForApprovedRequest(workspaceId, req.id);
      // Aprobar expresamente una remesa autoriza también que el agente local
      // recoja ese trabajo. Así el enlace del email arranca el flujo completo,
      // aunque el interruptor estuviera pausado. Nunca autoriza la firma.
      await setAgentClaimingEnabled(workspaceId, true);
    } catch (e) {
      await logEvent(req.id, "APPROVED", "APPROVED", opts.userId, "Aviso: no se pudo crear el trabajo bancario", String((e as any)?.message ?? e));
    }
    await notifyJobEmail("created", req).catch(() => {});
  }
  return { ok: true, status: target as "APPROVED" | "REJECTED" };
}

/** Marca como EXPIRED las solicitudes pendientes cuyo token caducó. Idempotente. */
export async function expireStaleRequests(workspaceId: string): Promise<number> {
  const now = new Date();
  const stale = await prisma.sepaRemittanceRequest.findMany({
    where: { workspaceId, status: "PENDING_APPROVAL", tokenExpiresAt: { lt: now } },
    select: { id: true }
  });
  if (stale.length === 0) return 0;
  await prisma.sepaRemittanceRequest.updateMany({
    where: { id: { in: stale.map((s) => s.id) }, status: "PENDING_APPROVAL" },
    data: { status: "EXPIRED" }
  });
  await prisma.sepaRemittanceEvent.createMany({
    data: stale.map((s) => ({ requestId: s.id, fromStatus: "PENDING_APPROVAL", toStatus: "EXPIRED", note: "Caducó el enlace de aprobación" }))
  });
  return stale.length;
}

/** Lista solicitudes (paginado + total) para la UI. */
export async function listRequests(
  workspaceId: string,
  opts?: { status?: string; page?: number; pageSize?: number }
): Promise<{ items: any[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(opts?.pageSize ?? 25, 100);
  const where: any = { workspaceId, archivedAt: null };
  if (opts?.status) where.status = opts.status;
  const [items, total] = await Promise.all([
    prisma.sepaRemittanceRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, status: true, companyName: true, clientName: true, invoiceNumber: true,
        amountCents: true, currency: true, mandateRef: true, ibanMasked: true, providerStatus: true,
        approvedAt: true, rejectedAt: true, rejectReason: true, chargeDate: true, createdAt: true, tokenExpiresAt: true
      }
    }),
    prisma.sepaRemittanceRequest.count({ where })
  ]);
  return { items, total, page, pageSize };
}
