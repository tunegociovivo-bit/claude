/**
 * Puente entre el ordenador que tiene los móviles conectados por USB («estación»)
 * y cualquier otro ordenador con acceso a F - Móviles.
 * La estación sube una imagen reducida de cada pantalla y recoge las órdenes
 * (tocar, atrás, escribir…) que envían los usuarios remotos. Vive en memoria:
 * son datos efímeros y no se guardan en la base de datos.
 */
export type StationSnapshot = { image: Buffer; mime: string; width: number; height: number; at: number; working: string; label: string };
export type StationCommand =
  | { id: string; type: "tap"; x: number; y: number; at: number; by: string }
  | { id: string; type: "swipe"; x: number; y: number; x2: number; y2: number; at: number; by: string }
  | { id: string; type: "back" | "home" | "recents"; at: number; by: string }
  | { id: string; type: "text"; text: string; at: number; by: string }
  | { id: string; type: "openUrl"; url: string; at: number; by: string };

const VIEWER_WINDOW_MS = 20_000;
const COMMAND_TTL_MS = 30_000;
const MAX_COMMANDS = 20;

const snapshots = new Map<string, StationSnapshot>();
const viewers = new Map<string, number>();
const commands = new Map<string, StationCommand[]>();
const key = (workspaceId: string, serial: string) => `${workspaceId}:${serial}`;

export function saveSnapshot(workspaceId: string, serial: string, snapshot: StationSnapshot) {
  snapshots.set(key(workspaceId, serial), snapshot);
}
export function readSnapshot(workspaceId: string, serial: string): StationSnapshot | null {
  return snapshots.get(key(workspaceId, serial)) ?? null;
}
export function snapshotInfo(workspaceId: string, serial: string) {
  const snapshot = snapshots.get(key(workspaceId, serial));
  return snapshot ? { at: snapshot.at, width: snapshot.width, height: snapshot.height, working: snapshot.working } : null;
}
export function markViewer(workspaceId: string, serial: string, now = Date.now()) {
  viewers.set(key(workspaceId, serial), now);
}
/** ¿Alguien está mirando esta pantalla desde otro ordenador? Entonces se envía más a menudo. */
export function hasViewers(workspaceId: string, serial: string, now = Date.now()) {
  const last = viewers.get(key(workspaceId, serial));
  return last !== undefined && now - last <= VIEWER_WINDOW_MS;
}
export function queueCommand(workspaceId: string, serial: string, command: StationCommand) {
  const list = (commands.get(key(workspaceId, serial)) ?? []).filter((item) => Date.now() - item.at <= COMMAND_TTL_MS);
  list.push(command);
  commands.set(key(workspaceId, serial), list.slice(-MAX_COMMANDS));
}
/** La estación recoge las órdenes pendientes (y caducan a los 30 s si nadie las recoge). */
export function takeCommands(workspaceId: string, serial: string, now = Date.now()): StationCommand[] {
  const list = (commands.get(key(workspaceId, serial)) ?? []).filter((item) => now - item.at <= COMMAND_TTL_MS);
  commands.delete(key(workspaceId, serial));
  return list;
}
export function resetStationRelayForTests() { snapshots.clear(); viewers.clear(); commands.clear(); }
