/**
 * Configuración del agente. Se lee de (por orden de prioridad):
 *   1. Variables de entorno.
 *   2. Un fichero JSON local protegido (agent.config.json o el indicado en
 *      AGENT_CONFIG_FILE) — pensado para permisos 600 en disco.
 *
 * INVARIANTE: aquí NUNCA hay credenciales del banco. Solo la URL del HUB, el
 * token del agente (emitido por el HUB) y parámetros operativos.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type SantanderMode = "mock" | "live";

export interface AgentConfig {
  hubUrl: string;
  agentToken: string;
  santanderOrigin: string;
  chromeCdpUrl: string;
  santanderMode: SantanderMode;
  selectorsFile: string;
  heartbeatSeconds: number;
  pollSeconds: number;
  logLevel: "info" | "debug";
  version: string;
}

function loadDotEnv(): void {
  // Carga mínima de .env sin dependencias externas (no sobreescribe variables ya definidas).
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function loadJsonFile(): Record<string, any> {
  const file = process.env.AGENT_CONFIG_FILE || "agent.config.json";
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new Error(`No se pudo leer/parsear el fichero de configuración: ${p}`);
  }
}

function pick(json: Record<string, any>, envKey: string, jsonKey: string, fallback?: string): string | undefined {
  return process.env[envKey] ?? json[jsonKey] ?? fallback;
}

export function loadConfig(pkgVersion: string): AgentConfig {
  loadDotEnv();
  const json = loadJsonFile();

  const hubUrl = pick(json, "HUB_URL", "hubUrl");
  const agentToken = pick(json, "AGENT_TOKEN", "agentToken");
  const santanderOrigin = pick(json, "SANTANDER_ORIGIN", "santanderOrigin", "https://empresas3.gruposantander.es")!;
  const chromeCdpUrl = pick(json, "CHROME_CDP_URL", "chromeCdpUrl", "http://127.0.0.1:9222")!;
  const santanderMode = (pick(json, "SANTANDER_MODE", "santanderMode", "mock") as SantanderMode);
  const selectorsFile = pick(json, "SELECTORS_FILE", "selectorsFile", "./selectors.json")!;
  const heartbeatSeconds = Number(pick(json, "HEARTBEAT_SECONDS", "heartbeatSeconds", "30"));
  const pollSeconds = Number(pick(json, "POLL_SECONDS", "pollSeconds", "15"));
  const logLevel = (pick(json, "LOG_LEVEL", "logLevel", "info") as "info" | "debug");

  const errors: string[] = [];
  if (!hubUrl) errors.push("Falta HUB_URL");
  else if (!/^https:\/\//i.test(hubUrl)) errors.push("HUB_URL debe ser HTTPS");
  if (!agentToken) errors.push("Falta AGENT_TOKEN (enrola el agente en el HUB)");
  if (!/^https:\/\//i.test(santanderOrigin)) errors.push("SANTANDER_ORIGIN debe ser HTTPS");
  if (santanderMode !== "mock" && santanderMode !== "live") errors.push("SANTANDER_MODE debe ser 'mock' o 'live'");
  if (errors.length) throw new Error("Configuración inválida:\n - " + errors.join("\n - "));

  return {
    hubUrl: hubUrl!.replace(/\/+$/, ""),
    agentToken: agentToken!,
    santanderOrigin: santanderOrigin.replace(/\/+$/, ""),
    chromeCdpUrl,
    santanderMode,
    selectorsFile,
    heartbeatSeconds: Number.isFinite(heartbeatSeconds) && heartbeatSeconds > 0 ? heartbeatSeconds : 30,
    pollSeconds: Number.isFinite(pollSeconds) && pollSeconds > 0 ? pollSeconds : 15,
    logLevel: logLevel === "debug" ? "debug" : "info",
    version: pkgVersion
  };
}
