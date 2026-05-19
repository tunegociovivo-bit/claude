/**
 * Tipos compartidos del agente "Sonia". Fase 1.
 */

export type AiAgentConfig = {
  /** User.id del usuario "Sonia". Las acciones (comentarios, status) se le firman a él. */
  userId: string;
  /** Project.id del proyecto buzón ("🤖 Sonia — Tareas IA"). */
  inboxProjectId: string;
  /** Modelo Claude por defecto. */
  model: string;
  /** Tope duro de iteraciones del agent loop. */
  maxStepsPerRun: number;
  /** Tope duro de output_tokens acumulados (entrada + salida). Más allá → REQUIRES_HUMAN. */
  maxTokensPerRun: number;
};

export const DEFAULT_AGENT_CONFIG: Omit<AiAgentConfig, "userId" | "inboxProjectId"> = {
  model: "claude-opus-4-7",
  // 25 era el cap antiguo, suficiente para tareas simples (responder
  // comentario, marcar completo, generar 1 borrador). Pero tareas
  // reales tipo "clonar campaña Meta + crear lead form + ad creative
  // con QC + cleanup duplicadas + duplicar escenario Make" implican
  // 30-50 tool calls. Subido a 60 — a Anthropic le cobramos por
  // tokens, no por pasos, así que tener margen no aumenta coste si
  // la task se completa rápido.
  maxStepsPerRun: 60,
  maxTokensPerRun: 400_000
};

export type AgentLogStep =
  | { type: "start"; ts: string; taskId: string }
  | { type: "thinking"; ts: string; text: string }
  | { type: "text"; ts: string; text: string }
  | { type: "tool_use"; ts: string; tool: string; input: unknown; toolUseId: string }
  | { type: "tool_result"; ts: string; toolUseId: string; output: unknown; isError?: boolean }
  | { type: "stop"; ts: string; reason: string; summary?: string }
  | { type: "error"; ts: string; message: string }
  | { type: "info"; ts: string; text: string }
  | { type: "escalation"; ts: string; issueUrl: string; issueNumber: number };

export type AgentRunResult = {
  status: "SUCCEEDED" | "FAILED" | "REQUIRES_HUMAN";
  summary: string | null;
  error: string | null;
  log: AgentLogStep[];
  stepsCount: number;
  inputTokens: number;
  outputTokens: number;
};
