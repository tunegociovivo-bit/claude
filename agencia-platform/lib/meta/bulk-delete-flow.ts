export type BulkDeleteFlow = { phase: "idle" | "confirming" | "running"; ids: string[] };
export type BulkDeleteEvent = { type: "request"; ids: string[] } | { type: "confirm" | "cancel" | "finish" };

export function bulkDeleteTransition(state: BulkDeleteFlow, event: BulkDeleteEvent): BulkDeleteFlow {
  if (event.type === "request" && state.phase === "idle" && event.ids.length) return { phase: "confirming", ids: [...event.ids] };
  if (event.type === "confirm" && state.phase === "confirming") return { phase: "running", ids: state.ids };
  if (event.type === "cancel" || event.type === "finish") return { phase: "idle", ids: [] };
  return state;
}
