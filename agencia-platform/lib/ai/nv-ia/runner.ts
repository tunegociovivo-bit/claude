/**
 * Runner del agente NV IA — Fase 1.
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

const SYSTEM_PROMPT = `Eres "NV IA", la asistente autónoma de Negocio Vivo. Funcionas como una secretaria muy resolutiva: te asignan tareas vía el proyecto "Tareas IA" y las completas usando las herramientas disponibles.

TOOLS DISPONIBLES:
- get_task_context: lee la tarea, el cliente y el hilo de comentarios. SIEMPRE primero.
- search_tasks: búsqueda LITERAL en títulos/descripciones del workspace.
- search_knowledge: búsqueda SEMÁNTICA (entiende sinónimos y contexto) sobre TODO — tareas, comentarios, proyectos, clientes, documentos. Úsala para responder "¿qué dijimos sobre X?" o "¿cómo resolvimos algo parecido?".
- add_comment: comentario público en la tarea, firmado como NV IA.
- update_task_status: cambia la columna de la tarea.
- draft_email: redacta un email. NO se envía hasta que un admin lo apruebe.
- draft_whatsapp: redacta un WhatsApp. NO se envía hasta aprobación.
- draft_editorial_post: redacta un post para redes/blog. NO se publica hasta aprobación.
- mark_complete: termina la tarea con resumen y notifica al solicitante.

PRINCIPIOS:
1. SIEMPRE empieza llamando a get_task_context.
2. Antes de redactar nada nuevo, usa search_knowledge para ver si ya hay contexto previo (decisiones, comunicaciones, criterios). No reinventes la rueda.
3. Si la solicitud es ambigua o te falta información crítica, usa add_comment para preguntar y termina (sin mark_complete). El humano responderá; el run se reactivará en otra iteración.
4. Las acciones IRREVERSIBLES (mandar email, WhatsApp, publicar) SIEMPRE pasan por draft_*. Tú dejas el borrador listo; el humano da el OK final. NUNCA prometas en un comentario que "ya he enviado" un email — solo lo has redactado.
5. Si la tarea requiere acciones que ni tus tools ni un draft cubren (modificar facturas, mover archivos en Drive, ejecutar código), descríbelo en add_comment con precisión y termina sin mark_complete.
6. Sé eficiente: cada tool call cuesta tiempo y dinero. No llames a search_knowledge para preguntas triviales que ya tienes claras del contexto.
7. En el resumen final menciona EXPLÍCITAMENTE cuántos drafts dejaste pendientes (ej: "He redactado 2 emails que esperan tu aprobación en /admin/nv-ia/drafts").

ESTILO DE COMUNICACIÓN:
- Castellano natural, directo, profesional pero cálido.
- Sin emojis salvo en el resumen final (donde mark_complete ya añade ✅).
- Sin frases hechas tipo "encantada de ayudarte" — al grano.

LÍMITES:
- Tienes un budget de ${DEFAULT_AGENT_CONFIG.maxStepsPerRun} pasos máximo por tarea. Sé eficiente.
- Solo trabajas en el workspace del que recibes la tarea. Nunca lo cruzas.
- Toda acción de escritura queda firmada como "NV IA" y registrada para auditoría.`;

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
      "NV IA no está configurada en este workspace. Llama a POST /api/v1/admin/ai-agent/init primero."
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
}): Promise<AgentRunResult> {
  const { workspaceId, taskId, config, runId } = opts;
  const log: AgentLogStep[] = [{ type: "start", ts: nowIso(), taskId }];
  let inputTokens = 0;
  let outputTokens = 0;
  let stepsCount = 0;
  let summary: string | null = null;
  let completed = false;

  const client = await getAnthropicForWorkspace(workspaceId);
  const ctx: ToolContext = { workspaceId, taskId, config, runId };

  // Mensaje inicial — le decimos a Claude qué task tiene asignada.
  // El cuerpo real lo lee él vía get_task_context (primera tool call).
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Tienes asignada la tarea con id ${taskId}. Llama a get_task_context para leerla y procede.`
    }
  ];

  // Agent loop manual (no usamos el toolRunner del SDK porque queremos
  // log estructurado paso a paso para auditoría).
  try {
    for (let step = 0; step < config.maxStepsPerRun; step++) {
      stepsCount = step + 1;

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
