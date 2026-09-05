import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function isRecoverableCdpFailure(error: unknown): boolean {
  const message = String((error as any)?.message ?? error);
  return /connectOverCDP|ECONNREFUSED|retrieving websocket|ws connected/i.test(message);
}

/** Reinicia exclusivamente el Chrome con perfil NVAgentChrome. */
export async function recoverDedicatedChrome(cdpUrl: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("La recuperación automática de Chrome solo está disponible en Windows");
  const url = new URL(cdpUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Solo se puede recuperar un Chrome CDP local");
  }
  const port = Number(url.port || 9222);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Puerto CDP inválido");
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const script = resolve(moduleDir, "../../install/restart-chrome.ps1");
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-Port", String(port)
  ], { timeout: 45_000, windowsHide: true });
}
