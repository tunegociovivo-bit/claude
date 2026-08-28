import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { metaAdsDownloadLeads } from "@/lib/integrations/meta-ads";
import { buildStyledXlsx } from "@/lib/files/xlsx-builder";
import { uploadAttachmentForTask } from "@/lib/files/sonia-upload";
import { buildS3Key, deleteObject, downloadBuffer, uploadBuffer } from "@/lib/storage/r2";

const TASK_ID = "cmst1b61k015n149uyqz1ztyk";
const FILENAME = "leads-nacionalidad-24-28-agosto-2026-3-campanas.xlsx";
const RETRY_MS = 30 * 60_000;
const RUNNING_TTL_MS = 60 * 60_000;
const META_REQUEST_TIMEOUT_MS = 75_000;
const CAMPAIGNS = [
  { id: "120212146667040107", name: "Formulario Nacionalidad" },
  { id: "120249841035430107", name: "Nacionalidad TEST Advantage+" },
  { id: "120249840971010107", name: "Nacionalidad Remarketing" }
] as const;

type ExportState = {
  status?: string;
  startedAt?: string;
  nextRetryAt?: string;
  error?: string;
  claimToken?: string;
  checkpoints?: Record<string, { s3Key: string; count: number }>;
};

async function updateExportState(taskId: string, patch: Record<string, unknown>, claimToken?: string) {
  const json = JSON.stringify(patch);
  const updated = claimToken
    ? await prisma.$executeRaw`
        UPDATE "Task"
        SET "aiState" = jsonb_set(
          COALESCE("aiState"::jsonb, '{}'::jsonb),
          '{nationalityLeadsExport}',
          COALESCE("aiState"::jsonb -> 'nationalityLeadsExport', '{}'::jsonb) || ${json}::jsonb,
          true
        ), "updatedAt" = NOW()
        WHERE "id" = ${taskId}
          AND "aiState"::jsonb -> 'nationalityLeadsExport' ->> 'claimToken' = ${claimToken}
      `
    : await prisma.$executeRaw`
        UPDATE "Task"
        SET "aiState" = jsonb_set(
          COALESCE("aiState"::jsonb, '{}'::jsonb),
          '{nationalityLeadsExport}',
          COALESCE("aiState"::jsonb -> 'nationalityLeadsExport', '{}'::jsonb) || ${json}::jsonb,
          true
        ), "updatedAt" = NOW()
        WHERE "id" = ${taskId}
      `;
  return updated > 0;
}

async function ownsClaim(taskId: string, claimToken: string) {
  const fresh = await prisma.task.findUnique({ where: { id: taskId }, select: { aiState: true } });
  return (fresh?.aiState as any)?.nationalityLeadsExport?.claimToken === claimToken;
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, label: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    timer = setTimeout(() => controller.abort(new Error(`${label}: tiempo de espera agotado`)), META_REQUEST_TIMEOUT_MS);
    return await operation(controller.signal);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Operación puntual solicitada por el administrador. Es idempotente y deja
 * el resultado en la tarea original. Tras adjuntar el archivo no vuelve a
 * consultar Meta. */
export async function runNationalityLeadsExport(): Promise<{ status: string; count?: number }> {
  const task = await prisma.task.findUnique({
    where: { id: TASK_ID },
    select: { id: true, workspaceId: true, aiState: true }
  });
  if (!task) return { status: "task_not_found" };

  const existing = await prisma.file.findFirst({
    where: { workspaceId: task.workspaceId, targetType: "TASK", targetId: task.id, name: FILENAME },
    select: { id: true }
  });
  if (existing) return { status: "already_complete" };

  const state = ((task.aiState as any)?.nationalityLeadsExport ?? {}) as ExportState;
  if (state.status === "RUNNING" && state.startedAt && Date.now() - Date.parse(state.startedAt) < RUNNING_TTL_MS) {
    return { status: "already_running" };
  }
  if (state.nextRetryAt && Date.parse(state.nextRetryAt) > Date.now()) return { status: "cooldown" };

  const claimToken = randomUUID();
  const claimed = await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${`one-off:${TASK_ID}:nationality-export`})) AS locked
    `;
    if (!lock[0]?.locked) return false;
    const fresh = await tx.task.findUnique({ where: { id: TASK_ID }, select: { aiState: true } });
    const freshState = ((fresh?.aiState as any)?.nationalityLeadsExport ?? {}) as ExportState;
    if (freshState.status === "RUNNING" && freshState.startedAt && Date.now() - Date.parse(freshState.startedAt) < RUNNING_TTL_MS) return false;
    const claimJson = JSON.stringify({
      ...freshState,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      claimToken,
      nextRetryAt: null,
      error: null
    });
    await tx.$executeRaw`
      UPDATE "Task"
      SET "aiState" = jsonb_set(COALESCE("aiState"::jsonb, '{}'::jsonb),
        '{nationalityLeadsExport}', ${claimJson}::jsonb, true), "updatedAt" = NOW()
      WHERE "id" = ${TASK_ID}
    `;
    return true;
  });
  if (!claimed) return { status: "already_running" };

  try {
    const freshTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, select: { aiState: true } });
    const freshState = ((freshTask.aiState as any)?.nationalityLeadsExport ?? {}) as ExportState;
    const checkpoints = { ...(freshState.checkpoints ?? {}) };
    const downloads: Array<{ id: string; name: string; leads: Array<Record<string, string>> }> = [];
    // 24/08 00:00 Madrid (UTC+2) inclusivo → 29/08 00:00 Madrid exclusivo.
    const startUtc = Date.parse("2026-08-23T22:00:00.000Z");
    const endUtc = Date.parse("2026-08-28T22:00:00.000Z");
    for (const campaign of CAMPAIGNS) {
      let leads: Array<Record<string, string>>;
      const checkpoint = checkpoints[campaign.id];
      if (checkpoint?.s3Key) {
        try {
          leads = JSON.parse((await downloadBuffer(checkpoint.s3Key)).toString("utf8"));
          if (!Array.isArray(leads)) throw new Error("Checkpoint inválido");
        } catch {
          delete checkpoints[campaign.id];
          await updateExportState(task.id, { checkpoints }, claimToken);
          leads = [];
        }
      } else {
        leads = [];
      }
      if (!checkpoints[campaign.id]) {
        const result = await withTimeout((signal) => metaAdsDownloadLeads({
          workspaceId: task.workspaceId,
          campaignId: campaign.id,
          // Consulta un margen amplio; el corte exacto se hace debajo en UTC.
          since: "2026-08-23",
          until: "2026-08-29",
          signal
        }), campaign.name);
        if (result.leads.length >= 5000) {
          throw new Error(`${campaign.name}: Meta devolvió el máximo de 5000 leads; se requiere paginar para evitar un Excel incompleto`);
        }
        leads = result.leads.filter((lead) => {
          const time = Date.parse(lead.created_time ?? "");
          return Number.isFinite(time) && time >= startUtc && time < endUtc;
        });
        const s3Key = buildS3Key({
          workspaceId: task.workspaceId,
          targetType: "TASK",
          targetId: task.id,
          filename: `.nationality-export-${campaign.id}.json`
        });
        await uploadBuffer({ s3Key, body: Buffer.from(JSON.stringify(leads)), contentType: "application/json" });
        checkpoints[campaign.id] = { s3Key, count: leads.length };
        if (!(await ownsClaim(task.id, claimToken))) return { status: "lease_lost" };
        if (!(await updateExportState(task.id, { checkpoints }, claimToken))) return { status: "lease_lost" };
      }
      const unique = [...new Map(leads.map((lead) => [lead.lead_id || JSON.stringify(lead), lead])).values()];
      downloads.push({ ...campaign, leads: unique });
    }

    const labels: Record<string, string> = {
      created_time: "Fecha",
      full_name: "Nombre",
      phone_number: "Teléfono",
      email: "Email",
      lead_id: "Lead ID",
      campaign_id: "Campaign ID",
      adset_id: "Adset ID",
      ad_id: "Ad ID",
      form_id: "Form ID"
    };
    const order = ["created_time", "full_name", "phone_number", "email", "lead_id", "campaign_id", "adset_id", "ad_id", "form_id"];
    const total = downloads.reduce((sum, item) => sum + item.leads.length, 0);
    const workbook = await buildStyledXlsx({
      theme: "corporate",
      sheets: [
        {
          name: "Resumen",
          title: "Leads de campañas de Nacionalidad",
          subtitle: "Periodo: 24 al 28 de agosto de 2026 · Sin métricas económicas",
          rows: downloads.map((item) => ({ Campaña: item.name, "ID campaña": item.id, Leads: item.leads.length })),
          columnOrder: ["Campaña", "ID campaña", "Leads"]
        },
        ...downloads.map((item, index) => ({
          name: `${index + 1} ${item.name}`.slice(0, 31),
          title: item.name,
          subtitle: `${item.leads.length} leads · 24-28 agosto 2026`,
          rows: item.leads,
          columnLabels: labels,
          columnOrder: order
        }))
      ],
      meta: { title: FILENAME.replace(/\.xlsx$/i, ""), creator: "Hub Negocio Vivo" }
    });

    const ws = await prisma.workspace.findUnique({ where: { id: task.workspaceId }, select: { settings: true } });
    const userId = (ws?.settings as any)?.aiAgent?.userId;
    if (!userId) throw new Error("Sonia no tiene userId configurado en el workspace");
    if (!(await ownsClaim(task.id, claimToken))) return { status: "lease_lost" };
    const completedByAnotherWorker = await prisma.file.findFirst({
      where: { workspaceId: task.workspaceId, targetType: "TASK", targetId: task.id, name: FILENAME },
      select: { id: true }
    });
    if (completedByAnotherWorker) return { status: "already_complete" };
    await uploadAttachmentForTask({
      workspaceId: task.workspaceId,
      taskId: task.id,
      filename: FILENAME,
      body: workbook,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      uploadedByUserId: userId
    });
    await prisma.comment.create({
      data: {
        workspaceId: task.workspaceId,
        authorId: userId,
        targetType: "TASK",
        targetId: task.id,
        body: `✅ Excel final adjunto: **${FILENAME}**. Incluye las 3 campañas de Nacionalidad y ${total} leads en total, sin CPC, CPL, inversión, CTR ni otras métricas económicas.`
      }
    });
    if (!(await updateExportState(task.id, { status: "COMPLETE", completedAt: new Date().toISOString(), total, checkpoints }, claimToken))) {
      return { status: "lease_lost" };
    }
    await Promise.allSettled(Object.values(checkpoints).map((checkpoint) => deleteObject(checkpoint.s3Key)));
    await updateExportState(task.id, { checkpoints: {} }, claimToken);
    return { status: "complete", count: total };
  } catch (error: any) {
    await updateExportState(task.id, {
      status: "RETRY",
      nextRetryAt: new Date(Date.now() + RETRY_MS).toISOString(),
      error: String(error?.message ?? error).slice(0, 1000)
    }, claimToken).catch(() => undefined);
    return { status: "retry" };
  }
}
