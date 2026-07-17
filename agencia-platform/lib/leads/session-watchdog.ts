/**
 * Watchdog de sesiones WAHA: si una sesión se cae (STOPPED) la reinicia sola.
 *
 * Ciclo de vida WAHA: WORKING (conectada) · STARTING (arrancando) · SCAN_QR_CODE
 * (necesita escanear QR) · STOPPED (parada, auth cacheada) · FAILED (auth rota).
 *
 * Solo auto-reiniciamos las **STOPPED**: un `start` las devuelve a WORKING sin
 * intervención humana (típico tras un reinicio del servidor WAHA). Las FAILED /
 * SCAN_QR_CODE necesitan reescanear el QR (humano), así que NO se tocan — se ven
 * en rojo en el panel de números. Throttle por sesión (máx 1 reinicio cada
 * 10 min) para no entrar en bucle.
 */

import { prisma } from "@/lib/db/prisma";
import { getWhatsappProvider, getWahaConfig, getSession, startSession } from "@/lib/leads/waha";
import { logError } from "@/lib/monitoring/error-log";

const RESTART_THROTTLE_MS = 10 * 60 * 1000;
const _lastRestart = new Map<string, number>(); // `${wsId}:${session}` → ts

export async function autoRestartDownSessions(
  workspaceId: string
): Promise<{ restarted: string[]; checked: number }> {
  // Solo WAHA (Evolution gestiona su reconexión aparte).
  if ((await getWhatsappProvider(workspaceId)) !== "waha") return { restarted: [], checked: 0 };
  let cfg;
  try {
    cfg = await getWahaConfig(workspaceId);
  } catch {
    return { restarted: [], checked: 0 };
  }

  const { getLeadChannels } = await import("./channels");
  const channels = (await getLeadChannels(workspaceId)).filter((c: any) => c && c.active !== false);
  const names = Array.from(new Set([cfg.session, ...channels.map((c: any) => c.name)])).filter(Boolean);

  const restarted: string[] = [];
  for (const name of names) {
    const key = `${workspaceId}:${name}`;
    if (Date.now() - (_lastRestart.get(key) ?? 0) < RESTART_THROTTLE_MS) continue;

    let status: string | null = null;
    try {
      const s = await getSession({ workspaceId, session: name });
      status = String((s as any)?.status ?? "").toUpperCase();
    } catch {
      continue; // sesión inexistente o servidor inalcanzable → no forzamos nada
    }

    if (status === "STOPPED") {
      try {
        await startSession({ workspaceId, session: name });
        _lastRestart.set(key, Date.now());
        restarted.push(name);
        console.warn(`[waha-watchdog] sesión "${name}" estaba STOPPED → reiniciada (workspace ${workspaceId}).`);
      } catch (e) {
        _lastRestart.set(key, Date.now()); // aunque falle, respeta el throttle
        logError("waha-watchdog:restart", e, workspaceId);
      }
    }
  }
  return { restarted, checked: names.length };
}

/** Recorre todos los workspaces reiniciando sus sesiones caídas. */
export async function autoRestartDownSessionsAllWorkspaces(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  for (const ws of workspaces) {
    try {
      await autoRestartDownSessions(ws.id);
    } catch (e) {
      logError("waha-watchdog", e, ws.id);
    }
  }
}
