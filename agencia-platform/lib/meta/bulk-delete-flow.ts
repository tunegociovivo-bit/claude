export type BulkDeleteState = "idle" | "confirming" | "running";
export type BulkDeleteEvent = "request" | "confirm" | "cancel" | "finish";

export function bulkDeleteTransition(state: BulkDeleteState, event: BulkDeleteEvent): BulkDeleteState {
  if (event === "request" && state === "idle") return "confirming";
  if (event === "confirm" && state === "confirming") return "running";
  if (event === "cancel" || event === "finish") return "idle";
  return state;
}
