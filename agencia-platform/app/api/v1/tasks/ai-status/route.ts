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
import { getEscalationStatus } from "@/lib/ai/nv-ia/escalate-status";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

export const dynamic = "force-dynamic";

/**
 * Cache en memoria del aiUserId por workspaceId. Antes leíamos
 * Workspace.settings entero en CADA poll (cada 4s) solo para sacar
 * este string. settings ha crecido con speakCache, integrations,
 * etc — son decenas de KB de JSON parseado por nada.
 * TTL 5min — si el admin cambia aiUserId, la UI se sincroniza en
 * <5min, suficiente.
 */
const aiUserIdCache = new Map<string, { value: string | null; expiresAt: number }>();
async function getAiUserId(workspaceId: string): Promise<string | null> {
  const hit = aiUserIdCache.get(workspaceId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const value = ((ws?.settings as any)?.aiAgent?.userId as string) ?? null;
  aiUserIdCache.set(workspaceId, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
}

/**
 * Lógica compartida entre GET y POST. Acepta lista de taskIds y
 * devuelve estados de Sonia por task. Extraída en función propia
 * para poder reutilizarla en ambos métodos.
 *
 * GET con ?taskIds=a,b,c — para compatibilidad con clientes viejos.
 * POST con body {taskIds:[...]} — recomendado, evita el límite de
 * tamaño de URL/header del edge (Railway devuelve HTTP 431 con
 * querystrings grandes — pasaba en workspaces con >300 tasks).
 */
async function handler(api: any, ids: string[]) {
  ids = ids.slice(0, 1000);
  if (ids.length === 0) {
    const aiUserId = await getAiUserId(api.workspaceId);
    return NextResponse.json({ items: [], aiUserId: aiUserId ?? null });
  }

  // Primera pasada: metadata SIN el campo log. El log es Json que
  // crece a cientos de KB por run (todos los tool_use + tool_result
  // serializados). Antes lo traíamos en cada poll cada 4s para 50+
  // runs = MB de payload por petición. Lo fetcheamos solo cuando
  // realmente lo necesitamos (REQUIRES_HUMAN para escalation, RUNNING
  // para último tool_use).
  const runsBase = await prisma.aiAgentRun.findMany({
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
      lastIterationAt: true,
      inputTokens: true,
      outputTokens: true
    }
  });
  // Coste total por tarea = suma de tokens de TODOS sus runs × pricing.
  const { estimateCostMicros } = await import("@/lib/ai/usage");
  const { DEFAULT_MODEL } = await import("@/lib/ai/anthropic");
  const tokensByTask = new Map<string, { input: number; output: number }>();
  for (const r of runsBase) {
    const t = tokensByTask.get(r.taskId) ?? { input: 0, output: 0 };
    t.input += r.inputTokens ?? 0;
    t.output += r.outputTokens ?? 0;
    tokensByTask.set(r.taskId, t);
  }
  // Segunda pasada: solo los runs que necesitan log (escalation /
  // tool_use vivo).
  const runIdsNeedingLog = runsBase
    .filter((r) => r.status === "REQUIRES_HUMAN" || r.status === "RUNNING")
    .map((r) => r.id);
  const logsById = new Map<string, any>();
  if (runIdsNeedingLog.length > 0) {
    const logRows = await prisma.aiAgentRun.findMany({
      where: { id: { in: runIdsNeedingLog } },
      select: { id: true, log: true }
    });
    for (const lr of logRows) logsById.set(lr.id, lr.log);
  }
  const runs = runsBase.map((r) => ({ ...r, log: logsById.get(r.id) ?? [] }));

  const latestByTask = new Map<string, typeof runs[number]>();
  for (const r of runs) {
    if (!latestByTask.has(r.taskId)) latestByTask.set(r.taskId, r);
  }

  // WATCHDOG IMPLÍCITO — cada poll de la UI actúa como watchdog
  // sobre los runs visibles. Dos casos:
  //
  // 1. PENDING viejo (>45s): processRunInBackground crasheó antes
  //    de hacer el lock PENDING→RUNNING. Lo re-disparamos —
  //    idempotente por lock optimista.
  //
  // 2. RUNNING colgado: el runner mete tick `lastIterationAt` en
  //    cada paso del agent loop. Si lleva >3min sin tick, el
  //    proceso está muerto (Railway redeploy, OOM, timeout API
  //    sin retry). Lo marcamos FAILED + notificamos al requester.
  //    SIN esto el run se queda RUNNING para siempre y la card
  //    no avanza, el user no recibe nada.
  const PENDING_STALE_MS = 45_000;
  // Subido de 3min → 10min: hay tools que tardan 3-5 min en UN solo
  // step (generate_meta_ad_creative con auto-QC + 3 retries, descargar
  // 500 leads, exportar XLSX grande). 3 min mataba runs vivos. 10 min
  // sigue cazando procesos REALMENTE muertos (deploy / OOM / crash)
  // pero da margen a tools largas legítimas.
  const RUNNING_DEAD_MS = 10 * 60_000;
  const now = Date.now();
  for (const r of latestByTask.values()) {
    if (
      r.status === "PENDING" &&
      now - (r.startedAt ?? r.createdAt).getTime() > PENDING_STALE_MS
    ) {
      processRunInBackground(r.id);
      continue;
    }
    if (r.status === "RUNNING") {
      // Si nunca hubo tick, usamos startedAt. Si no, el último tick.
      const lastBeat = (r.lastIterationAt ?? r.startedAt ?? r.createdAt).getTime();
      if (now - lastBeat > RUNNING_DEAD_MS) {
        // Fire-and-forget: matar el run colgado y avisar.
        void killStuckRun(r.id, api.workspaceId, lastBeat).catch((e) =>
          console.warn("[ai-status] killStuckRun:", e?.message ?? e)
        );
      }
    }
  }

  // Para detectar "Sonia te ha contestado": leemos los últimos
  // comentarios de las tasks visibles y nos quedamos con el último
  // por task junto con quién lo escribió. Si el último es de Sonia
  // (= aiUserId del workspace) y posterior al humanReviewedAt del
  // run, hay respuesta sin ver.
  const aiUserId = (await getAiUserId(api.workspaceId)) ?? undefined;

  // OJO: antes esto traía TODOS los comments de TODAS las tasks
  // visibles cada poll — para tasks con 50+ comentarios eso son
  // miles de filas por petición (cada 4s). Solo necesitamos el
  // ÚLTIMO por task. DISTINCT ON via raw query nos da exactamente
  // 1 fila por taskId: la más reciente. O(N) en lugar de O(N×M).
  const recentComments: Array<{
    targetId: string;
    authorId: string | null;
    body: string;
    createdAt: Date;
  }> = aiUserId
    ? await prisma.$queryRaw`
        SELECT DISTINCT ON ("targetId")
          "targetId", "authorId", body, "createdAt"
        FROM "Comment"
        WHERE "workspaceId" = ${api.workspaceId}
          AND "targetType" = 'TASK'
          AND "targetId" = ANY(${ids}::text[])
        ORDER BY "targetId", "createdAt" DESC
      `
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

  const items = await Promise.all(ids.map(async (id) => {
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
          workedByAi: true,
          lastAiCommentAt: lastComment!.createdAt.toISOString(),
          lastAiCommentPreview: lastComment!.body.slice(0, 140)
        };
      }
      return { taskId: id, aiStatus: null, workedByAi: false };
    }
    const escalation = extractEscalationFromLog(r.log);
    let visual:
      | "working"
      | "done_unreviewed"
      | "needs_help"
      | "claude_working"
      | "ai_replied"
      | "failed"
      | null = null;
    if (r.status === "PENDING" || r.status === "RUNNING") visual = "working";
    else if (r.status === "SUCCEEDED" && !r.humanReviewedAt) visual = "done_unreviewed";
    else if (r.status === "REQUIRES_HUMAN" && !r.humanReviewedAt) {
      visual = escalation ? "claude_working" : "needs_help";
    } else if (r.status === "FAILED" && !r.humanReviewedAt) {
      // CRÍTICO: si Sonia falla (timeout API, error de tool,
      // excepción no capturada) ANTES había null como visual y la
      // card volvía a blanca → el user no se enteraba. Ahora pinta
      // rojo intenso parpadeante con badge "❌ Sonia falló".
      visual = "failed";
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
      // Persistente: la tarea tiene historial de Sonia (algún run), aunque
      // el estado visual ya esté null (revisada/cerrada). Lo usa la UI para
      // marcar con un icono de robot las tareas que gestiona Sonia.
      workedByAi: true,
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
      // Solo consultamos GitHub si el visual es claude_working — para
      // las demás tasks no aporta info. Caché 60s en el helper evita
      // saturar la API de GitHub.
      claudeProgress: visual === "claude_working"
        ? await getEscalationStatus(r.log).catch(() => null)
        : null,
      lastStepText,
      lastToolName,
      // Tiempo del paso ACTUAL (desde el último tick) — para el banner,
      // distinto del total (startedAt) que muestra el badge de arriba.
      lastIterationAt: r.lastIterationAt ? r.lastIterationAt.toISOString() : null,
      // Coste total acumulado de la tarea (todos sus runs), en micros USD.
      costMicros: (() => {
        const t = tokensByTask.get(id);
        return t ? estimateCostMicros(DEFAULT_MODEL, t.input, t.output) : 0;
      })(),
      lastAiCommentAt: lastCommentIsAi ? lastComment!.createdAt.toISOString() : null,
      lastAiCommentPreview: lastCommentIsAi ? lastComment!.body.slice(0, 140) : null
    };
  }));

  // aiUserId también va en la respuesta — el cliente lo usa para
  // marcar visualmente las tareas asignadas a Sonia (icono robot)
  // sin tener que pedirlo en otra ruta separada.
  return NextResponse.json({ items, aiUserId: aiUserId ?? null });
}

// GET /api/v1/tasks/ai-status?taskIds=id1,id2,id3
// Compatibilidad con clientes viejos. Limitado a ~100 ids por el
// tamaño máximo de URL del edge.
export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("taskIds") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return handler(api, ids);
});

// POST /api/v1/tasks/ai-status  body: { taskIds: [...] }
// Recomendado — evita el HTTP 431 del edge cuando hay muchos
// taskIds. Lo usa el polling de /tareas (TareasClient).
export const POST = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body?.taskIds) ? body.taskIds : [];
  const ids = raw
    .filter((x: unknown): x is string => typeof x === "string" && x.length > 0);
  return handler(api, ids);
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

/**
 * Mata un run que lleva demasiado tiempo en RUNNING sin tick.
 *
 * Estrategia:
 *   1. Lock optimista: solo actuamos si el run sigue RUNNING y su
 *      lastIterationAt no se ha movido entre que lo vimos en el
 *      poll y este update (evita matar runs que justo acaban de
 *      revivir).
 *   2. Marcar FAILED con motivo explícito.
 *   3. Crear notification para el requester con call-to-action de
 *      "forzar reintento".
 *   4. Disparar escalación a Claude Code — si Sonia se cuelga es
 *      bug del runner que vale la pena investigar.
 */
async function killStuckRun(runId: string, workspaceId: string, lastBeatMs: number): Promise<void> {
  const errorMsg = `Run colgado en RUNNING sin tick durante >10min. Probable: proceso muerto (deploy / OOM / timeout API sin retry). Matado por watchdog del polling.`;

  // Update condicionado: si lastIterationAt cambió mientras tanto,
  // el run revivió → NO matamos.
  const expected = new Date(lastBeatMs);
  const r = await prisma.aiAgentRun.updateMany({
    where: {
      id: runId,
      workspaceId,
      status: "RUNNING",
      OR: [
        { lastIterationAt: null },
        { lastIterationAt: { lte: expected } }
      ]
    },
    data: {
      status: "FAILED",
      error: errorMsg,
      finishedAt: new Date()
    }
  });
  if (r.count === 0) return; // ya cambió, no era stuck de verdad

  // Notificar al requester con link a la tarea.
  const run = await prisma.aiAgentRun.findUnique({
    where: { id: runId },
    select: { taskId: true, requesterId: true }
  });
  if (run?.requesterId) {
    await prisma.notification
      .create({
        data: {
          userId: run.requesterId,
          type: "ai_agent_stuck",
          body: `⚠️ Sonia se quedó colgada en una tarea (run ${runId.slice(0, 8)}). El watchdog la ha marcado como fallida. Abre la tarea y pulsa "Pedir a Sonia" para reintentar.`,
          link: `/tareas?task=${run.taskId}`
        }
      })
      .catch(() => {});
  }

  // Escalar para que Claude analice por qué se colgó.
  try {
    const { escalateRunToGitHub } = await import("@/lib/ai/nv-ia/escalate");
    void escalateRunToGitHub(runId).catch(() => {});
  } catch {}
}
