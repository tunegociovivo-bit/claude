/**
 * Control cooperativo de búsquedas de leads: pausar / reanudar / cancelar.
 *
 * Estados: PENDING | RUNNING | PAUSING | PAUSED | CANCELLING | CANCELLED | COMPLETED | FAILED.
 * La transición es PURA y determinista (testeable sin BD). El worker (`processSearchBatch`)
 * respeta `controlSignal` entre lotes: nunca corrompe resultados ya guardados y reanuda desde
 * el checkpoint (`processedProvinces`) sin duplicar (upsert por workspaceId+placeId).
 */
export type SearchControlAction = "pause" | "resume" | "cancel";

export const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;
/** Estados que el poller/cron debe tomar para AVANZAR o FINALIZAR (incluye los transitorios,
 *  para que un PAUSING/CANCELLING sin lote en vuelo se finalice en el siguiente tick). */
export const DRIVER_STATUSES = ["PENDING", "RUNNING", "PAUSING", "CANCELLING"] as const;

export type ControlTransition =
  | { changed: true; status: string; controlSignal: string | null }
  | { changed: false; status: string; reason: string };

/**
 * Calcula la transición para una acción sobre un estado dado. Idempotente: repetir una acción
 * ya aplicada NO cambia nada (`changed:false`).
 */
export function computeControlTransition(current: string, action: SearchControlAction): ControlTransition {
  const isTerminal = (TERMINAL_STATUSES as readonly string[]).includes(current);

  if (action === "cancel") {
    if (isTerminal) return { changed: false, status: current, reason: "ya finalizada" };
    // Hay un lote potencialmente en vuelo (RUNNING) o una pausa en curso → señal cooperativa.
    if (current === "RUNNING" || current === "PAUSING" || current === "CANCELLING") {
      return { changed: true, status: "CANCELLING", controlSignal: "cancel" };
    }
    // PENDING o PAUSED → nada en ejecución → se cancela directamente.
    return { changed: true, status: "CANCELLED", controlSignal: null };
  }

  if (action === "pause") {
    if (isTerminal || current === "PAUSED" || current === "PAUSING") return { changed: false, status: current, reason: "no pausable" };
    if (current === "CANCELLING") return { changed: false, status: current, reason: "cancelación en curso" };
    if (current === "RUNNING") return { changed: true, status: "PAUSING", controlSignal: "pause" };
    // PENDING (aún no arrancó) → se pausa directamente.
    return { changed: true, status: "PAUSED", controlSignal: null };
  }

  // resume
  if (current === "PAUSED" || current === "PAUSING") return { changed: true, status: "PENDING", controlSignal: null };
  return { changed: false, status: current, reason: "no pausada" };
}

type PrismaLike = { leadSearch: { findFirst(a: any): Promise<any>; updateMany(a: any): Promise<{ count: number }> } };

/**
 * Aplica una acción de control TENANT-SCOPED e idempotente. Devuelve el estado resultante.
 * La escritura va guardada por `workspaceId` (aislamiento) y por el estado esperado
 * (concurrencia: si otro proceso ya lo movió, no se pisa).
 */
export async function requestSearchControl(
  prisma: PrismaLike,
  workspaceId: string,
  id: string,
  action: SearchControlAction
): Promise<{ ok: boolean; status: string; changed: boolean } | { ok: false; notFound: true }> {
  const row = await prisma.leadSearch.findFirst({ where: { id, workspaceId }, select: { id: true, status: true } });
  if (!row) return { ok: false, notFound: true };
  const t = computeControlTransition(row.status, action);
  if (!t.changed) return { ok: true, status: row.status, changed: false };
  const res = await prisma.leadSearch.updateMany({
    where: { id, workspaceId, status: row.status }, // guard por estado esperado (concurrencia)
    data: { status: t.status, controlSignal: t.controlSignal }
  });
  if (res.count !== 1) {
    // Otro proceso movió la fila entre la lectura y la escritura → releemos y devolvemos.
    const fresh = await prisma.leadSearch.findFirst({ where: { id, workspaceId }, select: { status: true } });
    return { ok: true, status: fresh?.status ?? row.status, changed: false };
  }
  return { ok: true, status: t.status, changed: true };
}
