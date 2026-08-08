/**
 * Punto de entrada del agente bancario LOCAL de Negocio Vivo.
 *
 * Uso:
 *   nv-bank-agent            → arranca el bucle (heartbeat + claim + preparar)
 *   nv-bank-agent --doctor   → comprueba configuración y conectividad, sin operar
 *   nv-bank-agent --record   → modo grabación guiada de selectores (sesión real)
 *
 * RECORDATORIO DE SEGURIDAD: el agente nunca firma, nunca cobra y nunca maneja
 * credenciales del banco. Tú inicias sesión y firmas; el agente solo prepara.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { Runner } from "./runner.js";
import { HubClient } from "./hub-client.js";

function pkgVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch { return "0.0.0"; }
}

async function doctor(cfg: ReturnType<typeof loadConfig>, log: Logger): Promise<void> {
  log.info("== Doctor del agente ==");
  log.info(`HUB: ${cfg.hubUrl}`);
  log.info(`Dominio Santander (allowlist): ${cfg.santanderOrigin}`);
  log.info(`Modo Santander: ${cfg.santanderMode}`);
  log.info(`CDP Chrome: ${cfg.chromeCdpUrl}`);
  // Prueba de heartbeat (verifica token y conectividad HTTPS con el HUB).
  const hub = new HubClient(cfg);
  try {
    const ok = await hub.heartbeat();
    log.info(ok ? "Heartbeat OK: el HUB reconoce el token del agente." : "Heartbeat RECHAZADO: revisa AGENT_TOKEN (¿revocado?).");
  } catch (e: any) {
    log.error(`No se pudo contactar con el HUB: ${e?.message ?? e}`);
  }
  // Comprobación de selectores si el modo es live.
  if (cfg.santanderMode === "live") {
    const { loadSelectors } = await import("./santander/selectors.js");
    const r = loadSelectors(cfg.selectorsFile);
    log.info(r.ok ? "Selectores: OK." : `Selectores: FALTAN → ${r.reason}`);
  }
  log.info("Doctor finalizado. No se ha operado en el banco.");
}

async function main() {
  const version = pkgVersion();
  const args = process.argv.slice(2);
  let cfg;
  try {
    cfg = loadConfig(version);
  } catch (e: any) {
    console.error(String(e?.message ?? e));
    process.exit(1);
    return;
  }
  const log = new Logger(cfg.logLevel);

  if (args.includes("--doctor")) { await doctor(cfg, log); return; }

  if (args.includes("--record")) {
    const { runRecorder } = await import("./santander/record.js");
    await runRecorder(cfg, log);
    return;
  }

  const runner = new Runner(cfg, log);
  const shutdown = () => { log.info("Deteniendo agente…"); runner.stop(); setTimeout(() => process.exit(0), 1500); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await runner.start();
}

void main();
