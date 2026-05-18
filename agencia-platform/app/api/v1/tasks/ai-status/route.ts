/**
 * GET /api/v1/tasks/ai-status?taskIds=id1,id2,id3
 *
 * Devuelve, para cada taskId, el último AiAgentRun (status + si está
 * pendiente de revisión humana) Y datos enriquecidos para mostrar
 * en UI un badge informativo:
 *   - aiStatus: "working" | "done_unreviewed" | "needs_help" | null
 *   - startedAt: cuándo arrancó (para "🤖 Trabajando 2m 14s")
 *   - finishedAt: cuándo terminó (para "✓ Lista hace 3m")
 *   - summary: resumen de éxito (50 primeros chars)
 *   - error: motivo de fallo (50 primeros chars)
 *   - stepsCount: cuántos pasos ejecutó
 *   - runId: para acciones tipo "marcar revisado"
 *
 * Mantenemos response ligera para que sea pollable cada N segundos
 * por la UI sin coste apreciable.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { extractEscalationFromLog } from "@/lib/ai/nv-ia/escalate";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("taskIds") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return NextResponse.json({ items: [] });

  const runs = await prisma.aiAgentRun.findMany({
    where: { workspaceId: api.workspaceId, taskId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      taskId: true,
      status: true,
      humanReviewedAt: true,
      summary: true,
      error: true,
      stepsCount: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      updatedAt: true,
      log: true
    }
  });

  const latestByTask = new Map<string, typeof runs[number]>();
  for (const r of runs) {
    if (!latestByTask.has(r.taskId)) latestByTask.set(r.taskId, r);
  }

  // WATCHDOG IMPLÍCITO: si hay runs PENDING que llevan >45s en la
  // cola, los re-disparamos fire-and-forget. processRunInBackground
  // es idempotente (lock optimista en updateMany) — si ya está
  // corriendo otro proceso, simplemente skip.
  //
  // Pasa cuando processRunInBackground se llamó pero crasheó al
  // import / al primer await, sin llegar a marcar RUNNING. Antes el
  // run quedaba PENDING para siempre y el user veía "Sonia bloqueada".
  // Ahora cada vez que abres /tareas, el polling de la UI actúa como
  // watchdog: re-dispara los PENDING viejos y Sonia arranca.
  const PENDING_STALE_MS = 45_000;
  const now = Date.now();
  for (const r of latestByTask.values()) {
    if (
      r.status === "PENDING" &&
      now - (r.startedAt ?? r.createdAt).getTime() > PENDING_STALE_MS
    ) {
      processRunInBackground(r.id);
    }
  }

  // Para detectar "Sonia te ha contestado": leemos los últimos
  // comentarios de las tasks visibles y nos quedamos con el último
  // por task junto con quién lo escribió. Si el último es de Sonia
  // (= aiUserId del workspace) y posterior al humanReviewedAt del
  // run, hay respuesta sin ver.
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const aiUserId = (ws?.settings as any)?.aiAgent?.userId as string | undefined;

  const recentComments = aiUserId
    ? await prisma.comment.findMany({
        where: {
          workspaceId: api.workspaceId,
          targetType: "TASK",
          targetId: { in: ids }
        },
        orderBy: { createdAt: "desc" },
        select: { targetId: true, authorId: true, body: true, createdAt: true }
      })
    : [];
  const lastCommentByTask = new Map<
    string,
    { authorId: string | null; body: string; createdAt: Date }
  >();
  for (const c of recentComments) {
    if (!lastCommentByTask.has(c.targetId!)) {
      lastCommentByTask.set(c.targetId!, {
        authorId: c.authorId,
        body: c.body ?? "",
        createdAt: c.createdAt
      });
    }
  }

  const items = ids.map((id) => {
    const r = latestByTask.get(id);
    const lastComment = lastCommentByTask.get(id);
    const lastCommentIsAi = aiUserId && lastComment?.authorId === aiUserId;
    if (!r) {
      // Aunque no haya run, puede haber comentario reciente de Sonia
      // (ej tarea histórica). Si lo hay y no se ha "revisado", lo
      // mostramos también con el estilo "te ha contestado".
      if (lastCommentIsAi) {
        return {
          taskId: id,
          aiStatus: "ai_replied" as const,
          lastAiCommentAt: lastComment!.createdAt.toISOString(),
          lastAiCommentPreview: lastComment!.body.slice(0, 140)
        };
      }
      return { taskId: id, aiStatus: null };
    }
    const escalation = extractEscalationFromLog(r.log);
    let visual:
      | "working"
      | "done_unreviewed"
      | "needs_help"
      | "claude_working"
      | "ai_replied"
      | null = null;
    if (r.status === "PENDING" || r.status === "RUNNING") visual = "working";
    else if (r.status === "SUCCEEDED" && !r.humanReviewedAt) visual = "done_unreviewed";
    else if (r.status === "REQUIRES_HUMAN" && !r.humanReviewedAt) {
      visual = escalation ? "claude_working" : "needs_help";
    } else if (
      // Sonia añadió un comentario después del último humanReviewedAt
      // del run (incluso aunque el run esté SUCCEEDED+reviewed). Esto
      // captura "Sonia te ha contestado nuevo" en hilos largos.
      lastCommentIsAi &&
      lastComment &&
      (!r.humanReviewedAt || lastComment.createdAt > r.humanReviewedAt)
    ) {
      visual = "ai_replied";
    }
    // Extraer "qué está haciendo ahora" del log para mostrarlo en la
    // banda interna de la card. Buscamos el ÚLTIMO tool_use o text
    // del modelo — eso es lo más reciente que Sonia ha "hecho".
    let lastStepText: string | null = null;
    let lastToolName: string | null = null;
    if (Array.isArray(r.log)) {
      for (let i = (r.log as any[]).length - 1; i >= 0; i--) {
        const step = (r.log as any[])[i];
        if (step?.type === "tool_use" && step.tool) {
          lastToolName = step.tool;
          lastStepText = `Usando ${humanizeTool(step.tool)}`;
          break;
        }
        if (step?.type === "text" && step.text) {
          lastStepText = step.text.slice(0, 140);
          break;
        }
      }
    }
    return {
      taskId: id,
      aiStatus: visual,
      runId: r.id,
      runStatus: r.status,
      startedAt: (r.startedAt ?? r.createdAt).toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      summary: r.summary ? r.summary.slice(0, 140) : null,
      error: r.error ? r.error.slice(0, 140) : null,
      stepsCount: r.stepsCount,
      reviewed: !!r.humanReviewedAt,
      escalationIssueUrl: escalation?.issueUrl ?? null,
      escalationIssueNumber: escalation?.issueNumber ?? null,
      lastStepText,
      lastToolName,
      lastAiCommentAt: lastCommentIsAi ? lastComment!.createdAt.toISOString() : null,
      lastAiCommentPreview: lastCommentIsAi ? lastComment!.body.slice(0, 140) : null
    };
  });

  return NextResponse.json({ items });
});

/** Convierte un nombre técnico de tool en texto legible para el badge. */
function humanizeTool(name: string): string {
  const map: Record<string, string> = {
    get_task_context: "leyendo la tarea",
    list_task_files: "buscando adjuntos",
    read_file_content: "leyendo un archivo",
    analyze_image: "analizando una imagen",
    search_tasks: "buscando tareas relacionadas",
    search_knowledge: "consultando memoria",
    web_search: "buscando en internet",
    code_execution: "ejecutando código",
    add_comment: "escribiendo un comentario",
    update_task_status: "moviendo de columna",
    create_subtask: "creando subtareas",
    assign_task: "asignando a alguien",
    mark_complete: "cerrando la tarea",
    escalate_to_claude: "escalando a Claude Code",
    attach_file_to_task: "adjuntando un archivo",
    attach_report_to_task: "generando informe",
    meta_ads_list_campaigns: "consultando campañas Meta",
    meta_ads_get_campaign_insights: "leyendo métricas Meta",
    meta_ads_top_performers: "comparando campañas Meta",
    google_ads_list_campaigns: "consultando Google Ads",
    holded_list_invoices: "consultando Holded",
    stripe_list_customers: "consultando Stripe",
    draft_email: "redactando email",
    draft_whatsapp: "redactando WhatsApp",
    list_drive_files: "buscando en Drive",
    read_drive_file: "leyendo Drive",
    transcribe_audio: "transcribiendo audio",
    spawn_subagent: "pidiendo ayuda a sub-agente"
  };
  return map[name] ?? name.replace(/_/g, " ");
}
