/**
 * Tipos compartidos del agente "NV IA". Fase 1.
 */

export type AiAgentConfig = {
  /** User.id del usuario "NV IA". Las acciones (comentarios, status) se le firman a él. */
  userId: string;
  /** Project.id del proyecto buzón ("🤖 NV IA — Tareas IA"). */
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
  maxStepsPerRun: 25,
  maxTokensPerRun: 200_000
};

export type AgentLogStep =
  | { type: "start"; ts: string; taskId: string }
  | { type: "thinking"; ts: string; text: string }
  | { type: "text"; ts: string; text: string }
  | { type: "tool_use"; ts: string; tool: string; input: unknown; toolUseId: string }
  | { type: "tool_result"; ts: string; toolUseId: string; output: unknown; isError?: boolean }
  | { type: "stop"; ts: string; reason: string; summary?: string }
  | { type: "error"; ts: string; message: string };

export type AgentRunResult = {
  status: "SUCCEEDED" | "FAILED" | "REQUIRES_HUMAN";
  summary: string | null;
  error: string | null;
  log: AgentLogStep[];
  stepsCount: number;
  inputTokens: number;
  outputTokens: number;
};
