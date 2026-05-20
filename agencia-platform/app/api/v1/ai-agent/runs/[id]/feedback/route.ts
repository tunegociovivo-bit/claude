/**
 * POST /api/v1/ai-agent/runs/:id/feedback
 *
 * APRENDIZAJE DEL FEEDBACK. David revisa un resultado de Sonia y le
 * enseña qué hacer distinto la próxima vez. El feedback se guarda como
 * AiAgentLesson con scope derivado del tipo de task, así que en runs
 * FUTUROS similares Sonia ya lo aplica sin que David lo repita.
 *
 * Body:
 *   { feedback: string,         // qué corregir / preferencia de David
 *     scope?: string }          // opcional: forzar un scope concreto.
 *                               // Si no, se infiere de la task.
 *
 * Ejemplos de feedback:
 *   "El copy de los anuncios es muy largo, hazlo de máximo 2 frases"
 *   "Para RS Advocats usa siempre tono formal, nada de emojis"
 *   "Cuando crees campañas, deja el presupuesto en 10€ no 15€"
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { recordLesson, inferScopesForTask } from "@/lib/ai/nv-ia/lessons";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const run = await prisma.aiAgentRun.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, taskId: true }
  });
  if (!run) throw new ApiError(404, "run_not_found", "Run no encontrado");

  const body = await req.json().catch(() => null);
  const feedback = typeof body?.feedback === "string" ? body.feedback.trim() : "";
  if (feedback.length < 8) {
    throw new ApiError(400, "feedback_too_short", "El feedback es demasiado corto (mínimo 8 caracteres)");
  }

  // Derivar scope: si lo fuerzan, lo usamos; si no, lo inferimos de la
  // task. Si la task tiene cliente, también guardamos uno client-scoped
  // para que la preferencia aplique específicamente a ese cliente.
  const task = await prisma.task.findUnique({
    where: { id: run.taskId },
    select: { title: true, description: true, clientId: true }
  });

  const scopes: string[] = [];
  if (typeof body?.scope === "string" && body.scope.trim()) {
    scopes.push(body.scope.trim());
  } else if (task) {
    const inferred = inferScopesForTask({
      taskTitle: task.title,
      taskDescription: task.description ?? "",
      clientId: task.clientId
    });
    // Tomamos el scope más específico (no "general") + el del cliente.
    const specific = inferred.find((s) => s !== "general");
    if (specific) scopes.push(specific);
    if (task.clientId) scopes.push(`client:${task.clientId}`);
    if (scopes.length === 0) scopes.push("general");
  } else {
    scopes.push("general");
  }

  // Guardar la lección en cada scope (dedupe interno en recordLesson).
  const created: Array<{ scope: string; id: string; created: boolean }> = [];
  for (const scope of scopes) {
    const r = await recordLesson({
      workspaceId: api.workspaceId,
      scope,
      lesson: feedback,
      source: "human",
      taskId: run.taskId
    });
    created.push({ scope, ...r });
  }

  return NextResponse.json({
    ok: true,
    scopes,
    lessons: created,
    message: `Aprendido. Sonia aplicará esto en runs futuros (${scopes.join(", ")}).`
  });
});
