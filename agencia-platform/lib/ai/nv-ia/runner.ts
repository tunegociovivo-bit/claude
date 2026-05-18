/**
 * Runner del agente Sonia — Fase 1.
 *
 * Toma un AiAgentRun en PENDING, ejecuta el agent loop de Claude con
 * las tools definidas, y persiste el resultado.
 *
 * El loop es síncrono dentro de la request del cron — para Fase 1
 * basta. Si en Fase 2 queremos paralelizar runs largos, pasamos a un
 * job queue (BullMQ + Redis o Inngest).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";
import { logAiUsage } from "@/lib/ai/usage";
import { TOOL_DEFINITIONS, TOOL_EXECUTORS, type ToolContext } from "./tools";
import { DEFAULT_AGENT_CONFIG, type AgentLogStep, type AgentRunResult, type AiAgentConfig } from "./types";
import {
  extractAdhocCredentials,
  loadStoredAdhocCredentials,
  persistAdhocCredentials
} from "./adhoc-credentials";

/**
 * Resuelve las credenciales ad-hoc disponibles para este run:
 *
 *   1. Escanea descripción + comentarios de la task → credenciales NUEVAS.
 *   2. Si encuentra alguna, las persiste cifradas en
 *      Workspace.settings.adhocCredentials — sobreescriben las
 *      almacenadas con el mismo KEY.
 *   3. Lee las almacenadas (que ya incluyen las nuevas).
 *   4. Devuelve el map plano KEY → valor que el ToolContext usará.
 *
 * Resultado: pegar un token en CUALQUIER task lo hace disponible
 * para TODOS los siguientes runs hasta que se sustituya por otro
 * con el mismo KEY.
 */
async function loadAdhocCredentialsForTask(
  taskId: string,
  workspaceId: string
): Promise<Record<string, string>> {
  // 1) Extraer de la task actual
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
    select: { description: true, title: true }
  });
  const comments = await prisma.comment.findMany({
    where: { workspaceId, targetType: "TASK", targetId: taskId },
    select: { body: true },
    orderBy: { createdAt: "asc" }
  });
  const blob = [
    task?.title ?? "",
    task?.description ?? "",
    ...comments.map((c) => c.body ?? "")
  ].join("\n\n");
  const fresh = extractAdhocCredentials(blob);

  // 2) Persistir las nuevas (sobreescribe KEYs colisionantes, deja
  //    intactas las demás).
  if (Object.keys(fresh).length > 0) {
    try {
      await persistAdhocCredentials(workspaceId, fresh, taskId);
    } catch (e) {
      console.warn(
        "[sonia] no se pudieron persistir adhoc credentials:",
        (e as Error).message
      );
    }
  }

  // 3) Leer las almacenadas (ya incluyen las recién persistidas).
  //    Las del task ganan por si la persistencia falló por algún motivo.
  const stored = await loadStoredAdhocCredentials(workspaceId);
  return { ...stored, ...fresh };
}

const SYSTEM_PROMPT = `Eres "Sonia", la asistente autónoma de Negocio Vivo. Funcionas como una secretaria muy resolutiva: te asignan tareas vía el proyecto "Tareas IA" y las completas usando las herramientas disponibles.

TOOLS DISPONIBLES:
Lectura:
- get_task_context: lee la tarea, el cliente y el hilo de comentarios. SIEMPRE primero.
- list_task_files: lista los archivos adjuntos de la tarea.
- read_file_content: extrae el texto de un PDF / DOCX / XLSX / TXT / MD / CSV / JSON / HTML adjunto. Pasa el fileId de list_task_files.
- analyze_image: analiza una IMAGEN adjunta (PNG/JPEG/GIF/WebP) — mockup, screenshot, logo, infografía. Devuelve descripción y texto visible. Opcionalmente pasa una pregunta concreta.
- list_drive_files: lista archivos de la carpeta de Google Drive del workspace (filtra por nombre opcional). Solo ves los archivos dentro de la carpeta configurada.
- read_drive_file: lee texto de un Google Doc/Sheet/Slide/PDF/DOCX/XLSX en Drive. Pasa fileId de list_drive_files.
- transcribe_audio: transcribe un audio adjunto (WebM/MP3/M4A/WAV/OGG, max 25MB). Útil para notas de voz de clientes o reuniones grabadas. Devuelve texto.
- search_tasks: búsqueda LITERAL en títulos/descripciones del workspace.
- search_knowledge: búsqueda SEMÁNTICA (entiende sinónimos y contexto) sobre tareas, comentarios, proyectos, clientes, documentos. Para responder "¿qué dijimos sobre X?".
- get_calendar_events: eventos del calendario en un rango de fechas.
- web_search: búsqueda EN INTERNET (Anthropic la ejecuta server-side). Útil para info actualizada que no está en el workspace: tendencias del sector, normativa nueva, qué hace la competencia, datos públicos de empresas. NO la uses para info interna (eso es search_knowledge).
- code_execution: ejecuta Python en sandbox de Anthropic. Útil para cálculos numéricos complejos, generación de gráficos a partir de datos, regex sobre textos largos, validación de datos. NO accede a tu Drive, R2 ni BD — solo lo que le pegues en el prompt.

Facturación / ERP (Holded + Stripe):
- holded_list_invoices, holded_list_contacts, holded_list_quotes: lectura de Holded.
- stripe_list_customers, stripe_list_invoices: análogo para Stripe (suscripciones, cobros recurrentes).

Negociación autónoma (Φ3):
- get_pricing_rules: ANTES de cualquier negociación lee los servicios + rangos permitidos. NO inventes precios fuera de min/max — si el cliente pide menos del min, ESCALA con close_deal(outcome='escalated').
- create_deal: abre Deal cuando detectas intención de compra clara.
- propose_deal_to_lead(channel='email'|'whatsapp'): genera draft con la propuesta.
- counter_offer: ajusta términos en respuesta a contraoferta. Si el nuevo precio cae bajo el min de un servicio, la tool marca ESCALATED automáticamente y NO aplica.
- close_deal(outcome='won'|'lost'|'escalated'): cierra el ciclo. Si WON, después crea factura/presupuesto con draft_holded_*.

Publicidad (Meta Ads + Google Ads):
- meta_ads_list_ad_accounts, meta_ads_list_campaigns, meta_ads_get_campaign_insights,
  meta_ads_top_performers: lectura de campañas Meta (FB/IG). Métricas: impressions,
  clicks, spend, CTR, CPC, reach. Útil para informes de cliente y detección de
  campañas que conviene pausar/optimizar.
- google_ads_list_campaigns, google_ads_get_metrics: análogo para Google Ads.
  Incluye conversions y conversion_value — clave para análisis de ROAS.

Escritura inmediata (firmada como Sonia, sin aprobación):
- add_comment: comentario público en la tarea.
- update_task_status: cambia la columna de la tarea.
- get_team_members: lista los miembros del workspace (id, nombre, rol).
- assign_task: reemplaza los asignados de la tarea actual (notifica a los nuevos).
- create_subtask: parte la tarea en subtareas accionables, opcionalmente asignadas a personas concretas.
- notify_user: empuja notif push directa a un miembro concreto. Para urgencias que no pueden esperar a que vea un comentario. No abusar.
- tag_task: aplica etiquetas a la tarea actual (crea las que no existan). Útil para clasificar (urgente, cliente-X, redes...).
- set_task_due_date: programa/cambia/quita el deadline de la tarea.
- set_task_priority: cambia prioridad (LOW/MEDIUM/HIGH/URGENT). Úsalo para escalar.

Borradores (TODOS requieren aprobación humana antes de ejecutarse):
- draft_email: redacta email (Resend).
- draft_whatsapp: redacta mensaje WhatsApp (WAHA).
- draft_editorial_post: redacta post para redes/blog.
- draft_calendar_event: propone evento de calendario.
- draft_drive_file: propone un Google Doc/Sheet/Slides para crear en Drive. Útil para informes, hojas de seguimiento, propuestas largas.
- draft_gmb_post: propone un post para Google Business Profile (Google My Business). Hasta que la integración esté activa, el admin lo publica copiando manualmente.
- draft_holded_invoice / draft_holded_quote: factura o presupuesto en Holded. Al aprobar, se emite directamente en Holded. Usa holded_list_contacts ANTES para encontrar contactId.
- draft_stripe_payment_link: payment link de Stripe (URL única de cobro). amount en céntimos. Al aprobar, la URL se devuelve para enviar al cliente.

AUTO-APPROVE (Fase 18):
Algunos clientes pueden tener configurada auto-aprobación para ciertos kinds (settings.aiClientMemory.autoApproveDraftKinds). Cuando creas un draft de un kind auto-aprobado para ese cliente, se ejecuta INMEDIATAMENTE sin aprobación humana. El response del tool te lo indica con autoApproved=true. Esto NO altera tu lógica — sigue redactando como si fuera revisión humana; la diferencia es solo si el envío es inmediato o pendiente.

Memoria persistente (3 capas, aprende entre runs):
- get_client_memory / update_client_memory: por CLIENTE — preferencias, decisiones, rechazos previos. get_task_context ya inyecta la del cliente actual.
- get_workspace_memory / update_workspace_memory: GLOBAL del workspace — políticas, firma estándar, horario, criterios generales. get_task_context la inyecta SIEMPRE.
- get_user_memory / update_user_memory: por MIEMBRO del equipo — sus áreas, especialidades, horarios. get_task_context inyecta la del requester. Lee la de OTROS miembros antes de assign_task/create_subtask para no asignar a alguien que no maneja ese tema o está fuera.

Análisis cruzado y auto-mejora:
- query_knowledge_graph: búsqueda CRUZADA filtrada por cliente/sector/fecha.
- propose_new_tool: cuando detectas un patrón recurrente que no puedes resolver con tus tools, propón una nueva tool. Max 3 por run.
- start_client_workflow: arranca secuencia automática de pasos para un cliente (onboarding_7d, renewal_30d, churn_recovery_14d, etc.). El cron ejecuta cada paso solo cuando le toca por días.
- generate_image: crea imagen con OpenAI gpt-image-1 y la adjunta a la task. Útil para draft_editorial_post o ilustrar Drive docs.

Delegación a sub-agentes (solo para tareas grandes con piezas separables):
- spawn_subagent(role, instruction): delega análisis/investigación/redacción/revisión a una sub-IA. Roles: researcher, writer, analyst, reviewer. Sub-agente es READ-ONLY. Cap 5/run.

Cierre:
- mark_complete: termina la tarea con resumen y notifica al solicitante.

PRINCIPIOS:
1. SIEMPRE empieza llamando a get_task_context.
2. Si la tarea menciona "el documento", "el brief", "el PDF que adjunté" o similar, usa list_task_files + read_file_content para leerlo ANTES de hacer nada más. No le pidas al humano que te lo pase si ya está adjunto.
3. Antes de redactar nada nuevo, considera usar search_knowledge para ver si ya hay contexto previo (decisiones, comunicaciones, criterios). No reinventes la rueda — pero no abuses: si tienes contexto suficiente, ahorra el lookup.
4. Si la solicitud es ambigua o te falta información crítica, usa add_comment para preguntar y termina (sin mark_complete). El humano responderá; el run se reactivará en otra iteración.
5. Las acciones IRREVERSIBLES (mandar email/WhatsApp, publicar post, crear evento de calendario) SIEMPRE pasan por draft_*. Tú dejas el borrador listo; el humano da el OK final. NUNCA prometas en un comentario que "ya he enviado" o "ya he programado" — solo lo has redactado.
6. Si la tarea requiere acciones que ni tus tools ni un draft cubren (modificar facturas, mover archivos en Drive, ejecutar código), descríbelo en add_comment con precisión y termina sin mark_complete.
7. Sé eficiente: cada tool call cuesta tiempo y dinero. No llames a search_knowledge para preguntas triviales que ya tienes claras del contexto.
8. En el resumen final menciona EXPLÍCITAMENTE cuántos drafts dejaste pendientes (ej: "He redactado 2 emails que esperan tu aprobación en /admin/nv-ia/drafts").

CUÁNDO USAR SUB-AGENTES (spawn_subagent):
Solo cuando la tarea tiene piezas CLARAMENTE separables y al menos una es compleja por sí sola. Ejemplos buenos:
  - "Analiza este Excel de ventas Q4 y dame top 3 productos a impulsar" → spawn_subagent("analyst", ...)
  - "Investiga qué decisiones hemos tomado sobre pricing con este cliente" → spawn_subagent("researcher", ...)
  - "Redacta el primer borrador del email de 400 palabras para el cliente" → spawn_subagent("writer", ...)
  - "Revisa críticamente este plan que tengo y dime riesgos" → spawn_subagent("reviewer", ...)
Ejemplos MALOS (no spawnees por estas):
  - Buscar 1 dato puntual (usa search_knowledge tú directamente)
  - Comentar algo breve (hazlo tú con add_comment)
  - "Hazlo todo" — sé específica en la instruction, scope acotado
Usa varios sub-agentes en SECUENCIA si necesitas (researcher → writer + reviewer). El cap es 5 por run total.

CUÁNDO DELEGAR a humanos (create_subtask + assign_task):
- Si la tarea es grande pero algunas partes claramente las tiene que hacer un HUMANO (entrar a un sitio que no tienes acceso, llamar a alguien, reunirse), parte en subtareas y asígnalas.
- Antes de asignar, usa get_team_members para ver quién hay y qué rol tienen.
- Si la tarea entera te toca a ti, NO crees subtareas innecesarias.
- Cuando delegues, déjalo MUY claro en el comentario final: "He partido esto en 3 subtareas: 2 para María, 1 para Juan".

CONTEXTO DE INVOCACIÓN:
Te pueden invocar de DOS formas:
  (a) Compartiendo una tarea con el proyecto "Tareas IA" (la forma formal).
  (b) Mencionándote como @nv-ia en un comentario de cualquier tarea (vía rápida, conversacional).
En el caso (b) probablemente la conversación previa ya tiene contexto — léela bien con get_task_context antes de actuar. Frecuentemente el usuario solo quiere una pregunta puntual respondida con add_comment, no un trabajo completo.

ESTILO DE COMUNICACIÓN:
- Castellano natural, directo, profesional pero cálido.
- Sin emojis salvo en el resumen final (donde mark_complete ya añade ✅).
- Sin frases hechas tipo "encantada de ayudarte" — al grano.

LÍMITES:
- Tienes un budget de ${DEFAULT_AGENT_CONFIG.maxStepsPerRun} pasos máximo por tarea. Sé eficiente.
- Solo trabajas en el workspace del que recibes la tarea. Nunca lo cruzas.
- Toda acción de escritura queda firmada como "Sonia" y registrada para auditoría.`;

/**
 * Carga la config del agente desde Workspace.settings.aiAgent. Throws
 * si no está configurado (admin debe llamar al endpoint init primero).
 */
export async function loadAgentConfig(workspaceId: string): Promise<AiAgentConfig> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings = (ws?.settings as any) ?? {};
  const cfg = settings?.aiAgent;
  if (!cfg?.userId || !cfg?.inboxProjectId) {
    throw new Error(
      "Sonia no está configurada en este workspace. Llama a POST /api/v1/admin/ai-agent/init primero."
    );
  }
  return {
    userId: cfg.userId,
    inboxProjectId: cfg.inboxProjectId,
    model: cfg.model ?? DEFAULT_AGENT_CONFIG.model,
    maxStepsPerRun: cfg.maxStepsPerRun ?? DEFAULT_AGENT_CONFIG.maxStepsPerRun,
    maxTokensPerRun: cfg.maxTokensPerRun ?? DEFAULT_AGENT_CONFIG.maxTokensPerRun
  };
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Ejecuta UN run completo. No persiste — el caller (cron) decide
 * cuándo guardar (lo hace al final, con todo el log + tokens).
 */
export async function executeAgentRun(opts: {
  workspaceId: string;
  taskId: string;
  config: AiAgentConfig;
  /** Id del AiAgentRun (necesario para enlazar drafts creados en este run). */
  runId: string;
  /** Cómo se disparó este run (afecta al prompt inicial). */
  trigger?:
    | "MANUAL"
    | "MENTION"
    | "PROACTIVE_DEADLINE"
    | "PROACTIVE_STALE"
    | "SCHEDULED"
    | "WHATSAPP_INBOUND"
    | "EMAIL_INBOUND"
    | "CALL_INBOUND"
    | "STRATEGIC_REVIEW"
    | "OWNER_MODE_CHECK"
    | "COMPLIANCE_FLAG"
    | "LEAD_OPPORTUNITY"
    | "WORKFLOW_STEP"
    | "CHURN_RISK"
    | "SELF_HEALING"
    | "NEGOTIATION"
    | "LIVE_MEETING_TICK";
  /** Contexto extra del trigger (ej: "vence en 36h"). */
  triggerContext?: string | null;
}): Promise<AgentRunResult> {
  const { workspaceId, taskId, config, runId, trigger = "MANUAL", triggerContext } = opts;
  const log: AgentLogStep[] = [{ type: "start", ts: nowIso(), taskId }];
  let inputTokens = 0;
  let outputTokens = 0;
  let stepsCount = 0;
  let summary: string | null = null;
  let completed = false;

  const client = await getAnthropicForWorkspace(workspaceId);

  // Credenciales ad-hoc — si el user pegó tokens/api keys en la
  // descripción o en algún comentario, las extraemos y las pasamos
  // al ToolContext. Las tools de integración (meta-ads, holded,
  // stripe...) las usarán antes que las del workspace cifrado.
  // Útil cuando una integración oficial caducó y el user quiere
  // que Sonia trabaje YA con un token temporal.
  const adhocCredentials = await loadAdhocCredentialsForTask(taskId, workspaceId);
  if (Object.keys(adhocCredentials).length > 0) {
    log.push({
      type: "info" as any,
      ts: nowIso(),
      text: `Credenciales ad-hoc cargadas: ${Object.keys(adhocCredentials).join(", ")}`
    });
  }

  // ctx se PASA por referencia a todas las tool calls del run — el
  // contador de subagentsSpawned vive aquí para que se mantenga entre
  // varios spawn_subagent y respete el cap de 5/run.
  const ctx: ToolContext = {
    workspaceId,
    taskId,
    config,
    runId,
    subagentsSpawned: { count: 0 },
    adhocCredentials
  };

  // Mensaje inicial — adaptado al tipo de trigger. El contenido real
  // de la tarea lo lee él vía get_task_context (primera tool call).
  let initialContent = buildInitialMessage(taskId, trigger, triggerContext);
  if (Object.keys(adhocCredentials).length > 0) {
    // Avisamos al modelo de qué KEYs de credenciales temporales están
    // ya cargadas, sin revelar valores. Las tools las usarán
    // automáticamente sin que el modelo tenga que pasarlas.
    initialContent +=
      `\n\nNOTA: Tienes credenciales ad-hoc cargadas para este run y persistidas en el workspace: ${Object.keys(adhocCredentials).join(", ")}. ` +
      `Las tools de integración las usarán automáticamente — NO las pidas al user ni las copies en comentarios. ` +
      `Quedan guardadas cifradas hasta que se sustituyan por otras nuevas con el mismo KEY.`;
  }
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: initialContent }
  ];

  // Agent loop manual (no usamos el toolRunner del SDK porque queremos
  // log estructurado paso a paso para auditoría).
  try {
    for (let step = 0; step < config.maxStepsPerRun; step++) {
      stepsCount = step + 1;
      // Fase 50: tick de "vida" del run. Si el proceso muere, el
      // watchdog cron detecta runs RUNNING sin tick reciente y los
      // marca REQUIRES_HUMAN — sin esto, un crash deja la task en
      // RUNNING para siempre.
      try {
        await prisma.aiAgentRun.update({
          where: { id: runId },
          data: { lastIterationAt: new Date(), stepsCount }
        });
      } catch {
        // no bloqueamos por un fallo del tick
      }

      const resp = await client.messages.create({
        model: config.model,
        max_tokens: 4096,
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } as any }
        ],
        tools: TOOL_DEFINITIONS,
        messages
      });
      inputTokens += resp.usage.input_tokens ?? 0;
      outputTokens += resp.usage.output_tokens ?? 0;

      // Logueamos cada bloque del response.
      for (const block of resp.content) {
        if (block.type === "text" && block.text) {
          log.push({ type: "text", ts: nowIso(), text: block.text });
        } else if (block.type === "tool_use") {
          log.push({
            type: "tool_use",
            ts: nowIso(),
            tool: block.name,
            input: block.input,
            toolUseId: block.id
          });
        }
      }

      // Si terminó sin más tool calls — pero NO llamó a mark_complete,
      // lo marcamos como REQUIRES_HUMAN (no podemos cerrar la tarea
      // sin el resumen del finalizer).
      if (resp.stop_reason === "end_turn") {
        log.push({
          type: "stop",
          ts: nowIso(),
          reason: "end_turn_sin_mark_complete",
          summary: undefined
        });
        return {
          status: "REQUIRES_HUMAN",
          summary: null,
          error: "La IA terminó la conversación sin llamar a mark_complete. Revisa los comentarios que dejó en la tarea.",
          log,
          stepsCount,
          inputTokens,
          outputTokens
        };
      }

      // Procesar tool calls
      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (toolUses.length === 0 && resp.stop_reason === "tool_use") {
        // Defensivo: la API dice tool_use pero no hay bloques tool_use.
        throw new Error("stop_reason=tool_use sin bloques tool_use en content");
      }

      // Echo del turn del assistant
      messages.push({ role: "assistant", content: resp.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const executor = TOOL_EXECUTORS[tu.name];
        let output: unknown;
        let isError = false;
        if (!executor) {
          output = { error: `Tool desconocida: ${tu.name}` };
          isError = true;
        } else {
          try {
            output = await executor(tu.input as any, ctx);
            if (output && typeof output === "object" && "error" in output) isError = true;
          } catch (e: any) {
            output = { error: String(e?.message ?? e) };
            isError = true;
          }
        }
        log.push({
          type: "tool_result",
          ts: nowIso(),
          toolUseId: tu.id,
          output,
          isError
        });
        if (tu.name === "mark_complete" && !isError) {
          completed = true;
          summary = String((tu.input as any)?.summary ?? "");
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(output).slice(0, 8000),
          is_error: isError
        });
      }
      messages.push({ role: "user", content: toolResults });

      // Cortocircuito: si llamó a mark_complete con éxito, no seguimos.
      if (completed) {
        log.push({ type: "stop", ts: nowIso(), reason: "mark_complete", summary: summary ?? undefined });
        break;
      }

      // Tope de tokens acumulados
      if (inputTokens + outputTokens > config.maxTokensPerRun) {
        log.push({ type: "stop", ts: nowIso(), reason: "token_budget_exhausted" });
        return {
          status: "REQUIRES_HUMAN",
          summary: null,
          error: `Budget de tokens agotado (${inputTokens + outputTokens} > ${config.maxTokensPerRun}). Tarea parcialmente procesada — revisa el log.`,
          log,
          stepsCount,
          inputTokens,
          outputTokens
        };
      }
    }

    if (!completed) {
      log.push({ type: "stop", ts: nowIso(), reason: "max_steps_exhausted" });
      return {
        status: "REQUIRES_HUMAN",
        summary: null,
        error: `Alcanzado tope de ${config.maxStepsPerRun} pasos sin terminar. Revisa el log para ver qué hizo.`,
        log,
        stepsCount,
        inputTokens,
        outputTokens
      };
    }

    // Tracking de coste
    await logAiUsage({
      workspaceId,
      userId: config.userId,
      feature: "nv-ia-agent",
      provider: "anthropic",
      model: config.model,
      inputTokens,
      outputTokens,
      projectId: null
    }).catch(() => {});

    return {
      status: "SUCCEEDED",
      summary,
      error: null,
      log,
      stepsCount,
      inputTokens,
      outputTokens
    };
  } catch (e: any) {
    log.push({ type: "error", ts: nowIso(), message: String(e?.message ?? e) });
    return {
      status: "FAILED",
      summary: null,
      error: String(e?.message ?? e),
      log,
      stepsCount,
      inputTokens,
      outputTokens
    };
  }
}

function buildInitialMessage(
  taskId: string,
  trigger: string,
  ctx: string | null | undefined
): string {
  const base = `Tienes asignada la tarea con id ${taskId}.`;
  switch (trigger) {
    case "MENTION":
      return `${base} ALGUIEN TE HA MENCIONADO (@nv-ia) en un comentario — lee con get_task_context el hilo completo. Frecuentemente solo te están haciendo una pregunta puntual que responder con add_comment, NO un trabajo grande. Decide tras leer.`;
    case "PROACTIVE_DEADLINE":
      return `${base} TE HAS DISPARADO TÚ MISMA — el cron detectó que esta tarea está cerca de su deadline sin progreso suficiente. ${ctx ? `Contexto: ${ctx}.` : ""} Tu trabajo: leer la tarea, revisar comentarios recientes, y dejar un add_comment con un PLAN concreto de qué hacer (pasos accionables) o un aviso si está bloqueada esperando algo. Si puedes delegar partes con create_subtask + assign_task, hazlo. NO marques mark_complete a menos que la tarea esté realmente terminada — esto es un alert, no una resolución.`;
    case "PROACTIVE_STALE":
      return `${base} TE HAS DISPARADO TÚ MISMA — el cron detectó que esta tarea lleva mucho tiempo sin actividad estando en marcha. ${ctx ? `Contexto: ${ctx}.` : ""} Tu trabajo: revisar qué pasó (último comentario, último cambio), y dejar un add_comment preguntando estado (a quién corresponda) o proponiendo desbloqueo. NO marques mark_complete.`;
    case "SCHEDULED":
      return `${base} TE HAS DISPARADO TÚ MISMA en un repaso programado. ${ctx ? `Contexto: ${ctx}.` : ""} Procede según el contexto.`;
    case "WHATSAPP_INBOUND":
      return `${base} ENTRADA EXTERNA — un cliente o lead te ha escrito por WhatsApp. ${ctx ? `Contexto: ${ctx}.` : ""} El cuerpo del mensaje está en la description de la task. Tu trabajo: leerlo (get_task_context), entender qué pide, y O bien redactar un draft de respuesta WhatsApp con draft_whatsapp (que el admin aprobará), O dejar un add_comment explicando si requiere acción humana (datos sensibles, decisión comercial, etc.). Si el mensaje es trivial (gracias, ok, etc.) cierra con mark_complete sin draft.`;
    case "EMAIL_INBOUND":
      return `${base} ENTRADA EXTERNA — alguien te ha escrito por email. ${ctx ? `Contexto: ${ctx}.` : ""} El cuerpo entero del email está en la description de la task. Tu trabajo: leerlo, identificar la pregunta/petición, y O bien redactar un draft de respuesta con draft_email (para aprobación), O dejar un add_comment proponiendo qué humano debe responder y por qué. Si es spam/newsletter/auto-reply, cierra con mark_complete sin draft.`;
    case "CALL_INBOUND":
      return `${base} LLAMADA TELEFÓNICA recibida. ${ctx ? `Contexto: ${ctx}.` : ""} La transcripción completa está en la description (puede tener errores de transcripción — interpreta con sentido común). Tu trabajo: identificar la intención (consulta, queja, urgencia, info commercial, otro), si el cliente está en BD usa get_client_memory, y deja un add_comment con resumen + propuesta de acción siguiente. Si requiere callback o email, draft_whatsapp/draft_email. Si requiere intervención humana específica, usa notify_user al miembro adecuado.`;
    case "STRATEGIC_REVIEW":
      return `${base} REVISIÓN ESTRATÉGICA (Co-CEO). ${ctx ? `Contexto: ${ctx}.` : ""} La description contiene métricas agregadas del trimestre. Tu trabajo: analizar (con spawn_subagent analyst si quieres), redactar un INFORME con 3 secciones: (1) Análisis del período cerrado, (2) Predicción del siguiente, (3) 3 iniciativas concretas con coste/beneficio. Deja el informe como add_comment largo Y create_subtask por cada iniciativa propuesta (sin asignar — el humano elige owner). NO marques mark_complete — deja que el humano decida si aprobar las iniciativas.`;
    case "OWNER_MODE_CHECK":
      return `${base} OWNER MODE — eres responsable de un cliente y este es tu check periódico. ${ctx ? `Contexto: ${ctx}.` : ""} Revisa los KPIs en el contexto, identifica desviaciones, propón acciones. Si KPI cae, escala con notify_user al gestor humano. Si todo OK, deja un add_comment breve de status y mark_complete.`;
    case "COMPLIANCE_FLAG":
      return `${base} COMPLIANCE BLOQUEÓ algo. ${ctx ? `Contexto: ${ctx}.` : ""} Revisa qué se intentó hacer y por qué se bloqueó. Reformula la acción para cumplir o escala con add_comment + notify_user al admin.`;
    case "LEAD_OPPORTUNITY":
      return `${base} OPORTUNIDAD DE NEGOCIO detectada. ${ctx ? `Contexto: ${ctx}.` : ""} Investiga al lead (search_knowledge si hay histórico, web_search para info pública). Si parece buena oportunidad, redacta draft_email de acercamiento personalizado. Si no encaja, mark_complete con razón.`;
    case "WORKFLOW_STEP":
      return `${base} PASO DE WORKFLOW automático. ${ctx ? `Contexto: ${ctx}.` : ""} La INSTRUCCIÓN específica de este paso está en la description de la task. Síguela al pie y cierra con mark_complete cuando hayas dejado los drafts/comentarios correspondientes. El cron avanzará al siguiente paso solo cuando toque por fecha.`;
    case "CHURN_RISK":
      return `${base} RIESGO DE CHURN detectado por el cron. ${ctx ? `Contexto: ${ctx}.` : ""} Tu plan: 1) Investiga qué pasó con query_knowledge_graph + get_client_memory (últimos 60 días, comentarios negativos, deadlines fallados). 2) Si confirmas riesgo: considera start_client_workflow('churn_recovery_14d') que arranca secuencia de 4 pasos en 14 días. 3) Notify_user al gestor de cuenta con tu diagnóstico. 4) mark_complete con el plan elegido.`;
    case "SELF_HEALING":
      return `${base} AUTO-DIAGNÓSTICO de Sonia. ${ctx ? `Contexto: ${ctx}.` : ""} El cron detectó patrones de fallos recurrentes — están en la description. Para cada patrón decide: propose_new_tool si falta capacidad, update_workspace_memory con workaround si es prompt, o notify_user al admin si es bug. Cierra con mark_complete.`;
    case "NEGOTIATION":
      return `${base} NEGOCIACIÓN ACTIVA con un lead/cliente. ${ctx ? `Contexto: ${ctx}.` : ""} 1) Lee get_pricing_rules ANTES de proponer precios. 2) Si es contacto nuevo, create_deal. 3) Para responder a una contraoferta del lead, counter_offer y luego draft_email/whatsapp con suggestedReply. 4) Cuando se cierre, close_deal(outcome) + si won, draft_holded_invoice. NUNCA pases bajo minAmountEur sin escalar.`;
    case "LIVE_MEETING_TICK":
      return `${base} ASISTENCIA EN VIVO durante una reunión. ${ctx ? `Contexto: ${ctx}.` : ""} La description tiene la transcripción reciente. NO actúes sobre tools de escritura (drafts, comments) — solo OBSERVA y devuelve sugerencias breves vía add_comment marcado como "[LIVE]". Útil: identificar acción items, datos buscables (clientes mencionados, contratos), tono del cliente.`;
    case "MANUAL":
    default:
      return `${base} Llama a get_task_context para leerla y procede.`;
  }
}
