/**
 * Sub-agentes especializados de Sonia (Fase 9).
 *
 * El coordinator (Sonia principal) puede invocar sub-agentes para
 * delegar SUBTAREAS de investigación, análisis o redacción larga.
 * Cada sub-agente:
 *   - tiene un system prompt especializado (persona+criterio)
 *   - tiene un SUBSET de tools (todas read-only — los sub-agentes NO
 *     pueden escribir comentarios, crear drafts, asignar tareas; eso
 *     queda como responsabilidad del coordinator)
 *   - tiene un budget reducido (10 pasos, 30K tokens)
 *   - devuelve un texto final que el coordinator usa para seguir
 *
 * Límites para evitar costes desbocados:
 *   - max 1 nivel de profundidad (sub-agentes NO pueden spawn otros)
 *   - max 5 sub-agentes por run principal
 *   - cada sub-agent es síncrono dentro del tool call del padre
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import { TOOL_DEFINITIONS, TOOL_EXECUTORS, type ToolContext } from "./tools";
import type { AgentLogStep, AiAgentConfig } from "./types";

export type SubagentRole = "researcher" | "writer" | "analyst" | "reviewer";

const SUBAGENT_SYSTEM: Record<SubagentRole, string> = {
  researcher: `Eres un sub-agente INVESTIGADOR de Sonia. El coordinator te pide buscar y compilar información. Tu output: un brief estructurado con HALLAZGOS concretos + REFERENCIAS (ids de tareas, comentarios, archivos donde lo encontraste). Sin opinión, sin recomendaciones — solo hechos. Sé exhaustivo: si hay 5 fuentes relevantes, menciona las 5.`,
  writer: `Eres un sub-agente REDACTOR de Sonia. El coordinator te pide redactar un texto concreto (email, post, propuesta, resumen). Tu output: el texto pedido, listo para usar — sin meta-comentarios tipo "aquí tienes el borrador". Si necesitas contexto del cliente, léelo. Adapta tono y registro al cliente.`,
  analyst: `Eres un sub-agente ANALISTA de Sonia. El coordinator te pasa datos (PDFs, hojas de cálculo, imágenes) y te pide análisis. Tu output: insights numerados, cada uno con evidencia concreta. Identifica patrones, anomalías, oportunidades. Sin recomendaciones de acción (eso es del coordinator) — solo análisis.`,
  reviewer: `Eres un sub-agente REVISOR de Sonia. El coordinator te pasa un borrador/decisión y te pide opinión crítica. Tu output: lista de RIESGOS, OMISIONES, MEJORAS sugeridas. Sé directo y específico — no "considera revisar X" sino "X tiene este problema concreto". Si todo está bien, dilo claramente sin inventar críticas.`
};

const SUBAGENT_TOOLS: Record<SubagentRole, string[]> = {
  researcher: [
    "get_task_context",
    "list_task_files",
    "read_file_content",
    "analyze_image",
    "list_drive_files",
    "read_drive_file",
    "search_tasks",
    "search_knowledge",
    "get_client_memory",
    "get_team_members",
    "get_calendar_events"
  ],
  writer: [
    "get_task_context",
    "list_task_files",
    "read_file_content",
    "search_knowledge",
    "get_client_memory"
  ],
  analyst: [
    "get_task_context",
    "list_task_files",
    "read_file_content",
    "analyze_image",
    "list_drive_files",
    "read_drive_file",
    "search_knowledge"
  ],
  reviewer: [
    "get_task_context",
    "read_file_content",
    "search_knowledge",
    "get_client_memory"
  ]
};

const MAX_STEPS = 10;
const MAX_TOKENS = 30_000;

export type SubagentResult = {
  ok: boolean;
  text: string;
  stepsCount: number;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  log: AgentLogStep[];
  error?: string;
};

/**
 * Ejecuta un sub-agente. Síncrono dentro del tool call del padre.
 * No actualiza BD — los logs van anidados en el log del padre (el
 * caller los inserta como parte del tool_result).
 */
export async function runSubagent(opts: {
  workspaceId: string;
  taskId: string;
  config: AiAgentConfig;
  parentRunId: string;
  role: SubagentRole;
  instruction: string;
}): Promise<SubagentResult> {
  const { workspaceId, taskId, config, parentRunId, role, instruction } = opts;
  const log: AgentLogStep[] = [];
  const toolsUsed = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let stepsCount = 0;

  const ctx: ToolContext = { workspaceId, taskId, config, runId: parentRunId };
  // Filtrar tools al subset permitido para este rol
  const allowedNames = new Set(SUBAGENT_TOOLS[role]);
  const tools = TOOL_DEFINITIONS.filter((t) => allowedNames.has(t.name));

  try {
    const client = await getAnthropicForWorkspace(workspaceId);
    const system = SUBAGENT_SYSTEM[role];
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `El coordinator (Sonia) te ha invocado con esta instrucción:\n\n${instruction}\n\n(Contexto: estás trabajando sobre la tarea con id ${taskId}. Puedes llamar a get_task_context si necesitas el detalle.)\n\nCuando hayas terminado, responde con tu output final en texto plano. NO llames a más tools si ya tienes lo que necesitas — para — solo escribe la respuesta.`
      }
    ];

    let finalText = "";
    for (let step = 0; step < MAX_STEPS; step++) {
      stepsCount = step + 1;
      const resp = await client.messages.create({
        model: config.model,
        max_tokens: 2048,
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral" } as any }
        ],
        tools,
        messages
      });
      inputTokens += resp.usage.input_tokens ?? 0;
      outputTokens += resp.usage.output_tokens ?? 0;

      for (const block of resp.content) {
        if (block.type === "text" && block.text) {
          log.push({ type: "text", ts: new Date().toISOString(), text: `[subagent:${role}] ${block.text.slice(0, 500)}` });
          finalText = block.text; // último texto = resultado final
        } else if (block.type === "tool_use") {
          toolsUsed.add(block.name);
          log.push({
            type: "tool_use",
            ts: new Date().toISOString(),
            tool: `[subagent:${role}] ${block.name}`,
            input: block.input,
            toolUseId: block.id
          });
        }
      }

      if (resp.stop_reason === "end_turn") {
        return {
          ok: true,
          text: finalText.trim() || "(sub-agente terminó sin texto final)",
          stepsCount,
          toolsUsed: [...toolsUsed],
          inputTokens,
          outputTokens,
          log
        };
      }

      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      messages.push({ role: "assistant", content: resp.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const executor = TOOL_EXECUTORS[tu.name];
        let output: unknown;
        let isError = false;
        if (!executor) {
          output = { error: `Tool no disponible para sub-agente ${role}: ${tu.name}` };
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
        if (tu.name.startsWith("meta_ads_") && output && typeof output === "object") {
          const { metaGuardNote } = await import("@/lib/integrations/meta-rate-guard");
          (output as any)._metaGuard = await metaGuardNote();
        }
        log.push({
          type: "tool_result",
          ts: new Date().toISOString(),
          toolUseId: tu.id,
          output,
          isError
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(output).slice(0, 6000),
          is_error: isError
        });
      }
      messages.push({ role: "user", content: toolResults });

      if (inputTokens + outputTokens > MAX_TOKENS) {
        return {
          ok: false,
          text: finalText || "(sub-agente quedó sin budget de tokens)",
          stepsCount,
          toolsUsed: [...toolsUsed],
          inputTokens,
          outputTokens,
          log,
          error: `Sub-agente excedió budget ${MAX_TOKENS} tokens`
        };
      }
    }

    return {
      ok: false,
      text: finalText || "(sub-agente quedó sin pasos)",
      stepsCount,
      toolsUsed: [...toolsUsed],
      inputTokens,
      outputTokens,
      log,
      error: `Sub-agente excedió ${MAX_STEPS} pasos sin terminar`
    };
  } catch (e: any) {
    return {
      ok: false,
      text: "",
      stepsCount,
      toolsUsed: [...toolsUsed],
      inputTokens,
      outputTokens,
      log,
      error: String(e?.message ?? e)
    };
  }
}
