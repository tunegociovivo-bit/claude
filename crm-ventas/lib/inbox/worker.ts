import "server-only";
import { prisma } from "@/lib/prisma";
import { processConversationAi } from "@/lib/inbox/ai";
import { processOutbound } from "@/lib/inbox/outbound";
import { refreshLineStatus } from "@/lib/inbox/lines";
import { notifyWorkspaceUrgentAlert } from "@/lib/urgent-alert-delivery";

// Worker en proceso (Railway ejecuta `next start` de forma continua). Las
// reclamaciones son atómicas (updateMany con condición de estado), así que dos
// instancias no envían dos veces el mismo mensaje.

const state = globalThis as typeof globalThis & {
  __inboxAiRunning?: boolean;
  __inboxSendRunning?: boolean;
  __inboxStatusAt?: number;
  __inboxStatusRunning?: boolean;
};

const BAD_STATUSES = new Set(["FAILED", "STOPPED", "SCAN_QR_CODE", "NO_SESSION"]);

async function aiPhase() {
  if (state.__inboxAiRunning) return;
  state.__inboxAiRunning = true;
  try {
    // Generaciones colgadas (proceso reiniciado a mitad): se reintentan.
    await prisma.conversation.updateMany({
      where: { aiStatus: "generating", updatedAt: { lt: new Date(Date.now() - 3 * 60_000) } },
      data: { aiStatus: "pending", aiDueAt: new Date() },
    });
    const due = await prisma.conversation.findMany({
      where: { aiStatus: "pending", aiDueAt: { lte: new Date() } },
      orderBy: { aiDueAt: "asc" },
      take: 6,
      select: { id: true },
    });
    await Promise.all(
      due.map((c) =>
        processConversationAi(c.id).catch(async (error) => {
          console.error("[inbox-worker] IA:", error?.message);
          await prisma.conversation
            .update({ where: { id: c.id }, data: { aiStatus: "error", aiError: "No se pudo generar la respuesta" } })
            .catch(() => undefined);
        })
      )
    );
  } finally {
    state.__inboxAiRunning = false;
  }
}

async function sendPhase() {
  if (state.__inboxSendRunning) return;
  state.__inboxSendRunning = true;
  try {
    // Un envío interrumpido (proceso reiniciado a mitad) NO se reintenta a
    // ciegas: podría duplicarse en el móvil del cliente. Queda como fallido.
    // Se mide desde que se reclamó (un envío normal tarda < 1 min).
    await prisma.outboundMessage.updateMany({
      where: { status: "sending", claimedAt: { lt: new Date(Date.now() - 3 * 60_000) } },
      data: {
        status: "failed",
        lastError: "Envío interrumpido: puede que haya llegado. Revisa el chat antes de reintentar.",
      },
    });
    // El más antiguo de CADA número: un número con mucha cola no frena a los demás.
    const now = new Date();
    const perLine = await prisma.outboundMessage.groupBy({
      by: ["lineId"],
      where: { status: "queued", scheduledAt: { lte: now } },
      _min: { scheduledAt: true },
      orderBy: { _min: { scheduledAt: "asc" } },
      take: 40,
    });
    const heads = await Promise.all(
      perLine.map((g) =>
        prisma.outboundMessage.findFirst({
          where: { lineId: g.lineId, status: "queued", scheduledAt: { lte: now } },
          orderBy: { scheduledAt: "asc" },
          select: { id: true, lineId: true },
        })
      )
    );
    const byLine = new Map<string, string[]>();
    for (const item of heads) if (item) byLine.set(item.lineId, [item.id]);
    await Promise.all(
      [...byLine.values()].map((ids) =>
        processOutbound(ids[0]).catch((error) => {
          console.error("[inbox-worker] envío:", error?.message);
          return null;
        })
      )
    );
  } finally {
    state.__inboxSendRunning = false;
  }
}

async function statusPhase() {
  const now = Date.now();
  if (state.__inboxStatusRunning) return;
  if (state.__inboxStatusAt && now - state.__inboxStatusAt < 60_000) return;
  state.__inboxStatusAt = now;
  state.__inboxStatusRunning = true;
  try {
    await refreshAllStatuses();
  } finally {
    state.__inboxStatusRunning = false;
  }
}

async function refreshAllStatuses() {
  const lines = await prisma.whatsappLine.findMany({ where: { active: true } });
  for (const line of lines) {
    const before = line.lastStatus;
    const updated = await refreshLineStatus(line, 55_000).catch(() => line);
    // La línea principal ya la vigila el monitor de alertas existente.
    if (!line.isPrimary && before === "WORKING" && updated.lastStatus && BAD_STATUSES.has(updated.lastStatus)) {
      await notifyWorkspaceUrgentAlert(
        line.workspaceId,
        "WHATSAPP_LINE_DOWN",
        `Número «${line.label}»${line.phone ? ` (+${line.phone})` : ""}: estado ${updated.lastStatus}. Si pide QR, el móvil se desvinculó.`
      ).catch(() => undefined);
    }
  }
}

export async function runInboxTick() {
  await Promise.allSettled([aiPhase(), sendPhase(), statusPhase()]);
}

export function kickInboxWorker(delayMs = 0) {
  setTimeout(() => void runInboxTick().catch(() => undefined), delayMs).unref?.();
}
