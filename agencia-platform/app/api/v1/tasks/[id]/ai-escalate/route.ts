/**
 * POST /api/v1/tasks/:id/ai-escalate
 *
 * Botón "Claude" del modal de tarea: el user puede escalar
 * manualmente cuando ve que Sonia está perdida, entregando algo
 * pobre, o llevando demasiado rato. Atajo para no esperar al
 * watchdog automático ni a que Sonia llame escalate_to_claude
 * por su cuenta.
 *
 * Flujo:
 *   1. Aborta cualquier run PENDING/RUNNING en curso (FAILED
 *      con "abortado por user — escalando a Claude").
 *   2. Crea un AiAgentRun nuevo en REQUIRES_HUMAN con el contexto
 *      del user en triggerContext (qué quería, qué falló).
 *   3. Dispara escalateRunToGitHub → issue con @claude mention y
 *      todo el contexto (descripción, comentarios, log del run
 *      anterior si lo hubo).
 *   4. Comenta en la task firmado por Sonia "El user me ha pedido
 *      ayuda directa de Claude — investigando".
 *
 * UI: la card pasa a azul "🛠 Claude mejorando el sistema" con
 * link al issue. Cuando Claude termine el fix y llame
 * /ai-reprocess, la task se re-procesa automáticamente.
 *
 * Cualquier user con acceso a la task puede usarlo (no requiere
 * admin) — es la forma de "pedir ayuda" que el user tiene.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { escalateRunToGitHub } from "@/lib/ai/nv-ia/escalate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null } as any,
    select: { id: true, title: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  // Razón opcional que el user da al pulsar el botón.
  const body = await req.json().catch(() => ({}));
  const userReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";

  // Aborta runs en curso (no queremos competir con Sonia
  // mientras Claude analiza).
  const aborted = await prisma.aiAgentRun.updateMany({
    where: {
      workspaceId: api.workspaceId,
      taskId: params.id,
      status: { in: ["PENDING", "RUNNING"] }
    },
    data: {
      status: "FAILED",
      error: `Abortado por el user para escalar manualmente a Claude Code.${userReason ? " Motivo: " + userReason : ""}`,
      finishedAt: new Date()
    }
  });

  // Crea un run nuevo directamente en REQUIRES_HUMAN. NO arranca
  // Sonia — Claude es quien va a actuar ahora.
  const run = await prisma.aiAgentRun.create({
    data: {
      workspaceId: api.workspaceId,
      taskId: params.id,
      requesterId: api.userId,
      status: "REQUIRES_HUMAN" as any,
      trigger: "MANUAL" as any,
      triggerContext:
        `Escalación manual del user a Claude Code via botón "Claude" del modal.` +
        (userReason ? ` Motivo: ${userReason}` : "") +
        (aborted.count > 0 ? ` Se abortaron ${aborted.count} run(s) en curso.` : ""),
      summary: userReason
        ? `User pidió ayuda a Claude: ${userReason.slice(0, 200)}`
        : "User pidió ayuda a Claude vía botón del modal.",
      startedAt: new Date(),
      finishedAt: new Date()
    }
  });

  // Comentario informativo firmado por Sonia (si está configurada).
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: api.workspaceId },
      select: { settings: true }
    });
    const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
    if (aiUserId) {
      const noteLines = [
        `🛠 **El user me ha pedido ayuda directa de Claude Code para esta tarea.**`,
        ``,
        userReason ? `**Motivo del user:** ${userReason}` : "",
        aborted.count > 0
          ? `He pausado el run que estaba en curso para que Claude pueda analizar sin interferir.`
          : "",
        ``,
        `Claude leerá toda la tarea (descripción, comentarios, archivos adjuntos, log de mi último intento si lo hubo) y aplicará una mejora al sistema o me dará instrucciones para retomar. Cuando termine, la tarea se re-procesa automáticamente y recibirás aviso.`
      ].filter(Boolean);
      await prisma.comment
        .create({
          data: {
            workspaceId: api.workspaceId,
            authorId: aiUserId,
            targetType: "TASK",
            targetId: params.id,
            body: noteLines.join("\n")
          }
        })
        .catch(() => {});
    }
  } catch (e) {
    console.warn("[ai-escalate] comentario:", (e as Error).message);
  }

  // Disparar escalación a GitHub fire-and-forget.
  void escalateRunToGitHub(run.id).catch((e) =>
    console.warn("[ai-escalate] escalateRunToGitHub:", e?.message ?? e)
  );

  return NextResponse.json({
    ok: true,
    runId: run.id,
    aborted: aborted.count,
    message:
      aborted.count > 0
        ? `Abortado ${aborted.count} run(s) en curso. Claude está investigando — recibirás aviso cuando aplique mejora.`
        : "Claude está investigando — recibirás aviso cuando aplique mejora."
  });
});
