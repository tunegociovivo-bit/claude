/**
 * GET /api/v1/sonia/voice-inbox
 *
 * Devuelve el run de Sonia más reciente con acciones PENDIENTES de aprobar
 * (AiDraft en estado PENDING) — de CUALQUIER origen: llamada, email entrante,
 * tarea, etc. Es lo que el notificador de voz usa para avisar "puedo hacer
 * esto y esto" y que el usuario lo apruebe (incluye llamadas, email, WhatsApp).
 *
 * Solo admin (es el dueño quien recibe el aviso por voz).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { resolveRunOwnerId } from "@/lib/ai/nv-ia/run-owner";

export const dynamic = "force-dynamic";

const LOOKBACK_MS = 6 * 60 * 60 * 1000; // 6h: avisa de pendientes recientes

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");

  const since = new Date(Date.now() - LOOKBACK_MS);
  // Borradores PENDIENTES recientes (de cualquier run/origen), nuevos primero.
  const recent = await prisma.aiDraft.findMany({
    where: {
      workspaceId: api.workspaceId,
      status: "PENDING",
      aiAgentRunId: { not: null },
      createdAt: { gte: since }
    },
    orderBy: { createdAt: "desc" },
    select: { aiAgentRunId: true }
  });
  if (recent.length === 0) return NextResponse.json({ pending: null });

  // Aislamiento por usuario: cada quien solo oye los avisos de las tareas que
  // ÉL encargó a Sonia. Los runs automáticos (recurrentes, followups,
  // relanzamientos) heredan el dueño de la tarea; los verdaderamente sin dueño
  // (email/WhatsApp entrante, escaneos proactivos) son compartidos entre
  // admins. Los encargados por OTRO usuario quedan ocultos.
  const runIds = [...new Set(recent.map((d) => d.aiAgentRunId).filter((x): x is string => !!x))];
  const runsMeta = await prisma.aiAgentRun.findMany({
    where: { id: { in: runIds }, workspaceId: api.workspaceId },
    select: { id: true, taskId: true, requesterId: true }
  });
  const metaById = new Map(runsMeta.map((r) => [r.id, r]));
  // runIds viene en orden de recencia: elegimos el run visible más reciente.
  let runId: string | null = null;
  for (const id of runIds) {
    const meta = metaById.get(id);
    if (!meta) continue;
    const ownerId = await resolveRunOwnerId({
      workspaceId: api.workspaceId,
      taskId: meta.taskId,
      requesterId: meta.requesterId
    });
    if (ownerId === null || ownerId === api.userId) {
      runId = id;
      break;
    }
  }
  if (!runId) return NextResponse.json({ pending: null });

  const draftsRaw = await prisma.aiDraft.findMany({
    where: { workspaceId: api.workspaceId, aiAgentRunId: runId, status: "PENDING" },
    select: { id: true, title: true, kind: true, payload: true },
    orderBy: { createdAt: "asc" }
  });
  if (draftsRaw.length === 0) return NextResponse.json({ pending: null });

  // Detalle completo (guion de la llamada, texto del WhatsApp, asunto+cuerpo
  // del email…) para mostrarlo al pasar el ratón / tocar en el modal.
  function draftDetail(kind: string, payload: any, title: string): string {
    const p = (payload ?? {}) as any;
    if (kind === "PHONE_CALL") return String(p.goal ?? title);
    if (kind === "WHATSAPP") return String(p.text ?? title);
    if (kind === "EMAIL") {
      return [p.subject ? `Asunto: ${p.subject}` : "", String(p.text ?? p.html ?? "")]
        .filter(Boolean)
        .join("\n");
    }
    return title;
  }
  const drafts = draftsRaw
    .filter((d) => !(d.payload as any)?.blocked)
    .map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      detail: draftDetail(d.kind, d.payload, d.title).slice(0, 1500)
    }));
  const blocked = draftsRaw
    .filter((d) => (d.payload as any)?.blocked)
    .map((d) => {
      const p = (d.payload ?? {}) as any;
      return { id: d.id, action: String(p.action ?? d.title), missing: String(p.missing ?? "") };
    });

  const run = await prisma.aiAgentRun.findFirst({
    where: { id: runId, workspaceId: api.workspaceId },
    select: { id: true, taskId: true, summary: true, finishedAt: true }
  });

  const task = run?.taskId
    ? await prisma.task.findFirst({ where: { id: run.taskId, workspaceId: api.workspaceId }, select: { title: true } })
    : null;

  return NextResponse.json({
    pending: {
      runId,
      taskId: run?.taskId ?? null,
      taskTitle: task?.title ?? null,
      summary: run?.summary ?? null,
      finishedAt: run?.finishedAt ?? null,
      drafts,
      blocked
    }
  });
});
