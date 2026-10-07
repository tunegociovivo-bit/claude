/**
 * Pasarela a las APIs de Google Business Profile a través de Make.
 *
 * El proyecto de Google Cloud del Hub necesita que Google apruebe el acceso a las APIs de
 * Perfiles de Empresa (por defecto la cuota es 0). Mientras tanto —y como respaldo permanente—
 * el Hub llama a esas APIs con la conexión «Google Business Profile» de Make, cuya app sí está
 * aprobada: un escenario bajo demanda (módulo «Make an API Call») con entradas
 * domain/method/url/body que devuelve status y body. El Hub lo crea solo si no existe.
 */
import { prisma } from "@/lib/db/prisma";
import { makeActivateScenario, makeCreateScenario, makeListScenarios, makeRawCall } from "@/lib/integrations/make";

/** Un escenario pasarela por conexión de Make (cada cuenta de Google de cliente tiene la suya). */
export const gatewayName = (connId: number) => `HUB · Pasarela API Google Business Profile · conexión ${connId} (no borrar)`;

export const GBP_DOMAINS = {
  accounts: "https://mybusinessaccountmanagement.googleapis.com",
  info: "https://mybusinessbusinessinformation.googleapis.com",
  v4: "https://mybusiness.googleapis.com"
} as const;

export class MakeGatewayError extends Error {}

const cache = new Map<string, { id: number; at: number }>();

/** Conexión de Make por defecto (Ajustes del GMB Hub). */
export async function defaultMakeConnId(workspaceId: string): Promise<number | null> {
  return gmbConnId(workspaceId);
}

async function gmbConnId(workspaceId: string): Promise<number | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  const n = Number(g.makeGmbConn);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ¿Hay Make + conexión de Google Business Profile configurados en Ajustes del GMB Hub? */
export async function makeGatewayAvailable(workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const s = (ws?.settings as any) ?? {};
  return !!s?.integrations?.make?.apiTokenEnc && !!Number(s?.integrations?.gmb?.makeGmbConn);
}

export function gatewayBlueprint(connId: number) {
  return {
    name: gatewayName(connId),
    metadata: { version: 1 },
    flow: [
      {
        id: 1,
        module: "google-my-business:makeApiCall",
        version: 1,
        parameters: { __IMTCONN__: connId },
        mapper: { domain: "{{var.input.domain}}", method: "{{var.input.method}}", url: "{{var.input.url}}", body: "{{var.input.body}}" }
      },
      { id: 2, module: "scenario-service:ReturnData", version: 2, parameters: {}, mapper: { status: "{{1.statusCode}}", body: "{{1.body}}" } }
    ]
  };
}

export const GATEWAY_INTERFACE = {
  input: [
    { name: "domain", type: "text", required: true, label: "Dominio API" },
    { name: "method", type: "text", required: true, label: "Método" },
    { name: "url", type: "text", required: true, label: "Ruta" },
    { name: "body", type: "text", required: false, label: "Body JSON" }
  ],
  output: [
    { name: "status", type: "number", label: "Status" },
    { name: "body", type: "any", label: "Body" }
  ]
};

/** Id del escenario pasarela de una conexión (lo busca por nombre o lo crea, configura y activa). */
export async function ensureGateway(workspaceId: string, connId?: number | null): Promise<number> {
  const conn = connId ?? (await gmbConnId(workspaceId));
  if (!conn) throw new MakeGatewayError("Falta la conexión de Google Business Profile de Make en Ajustes del GMB Hub.");
  const key = `${workspaceId}:${conn}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < 3_600_000) return c.id;
  const name = gatewayName(conn);
  const found = (await makeListScenarios({ workspaceId, query: "Pasarela API Google Business Profile" })).find((s) => s.name === name);
  let id = found?.id;
  if (!id) {
    const s = await makeCreateScenario({ workspaceId, name, blueprint: gatewayBlueprint(conn), scheduling: { type: "on-demand" } });
    id = s.id;
    const r = await makeRawCall({ workspaceId, method: "PATCH", path: `/scenarios/${id}/interface`, body: { interface: GATEWAY_INTERFACE } });
    if (!r.ok) throw new MakeGatewayError(`No se pudo configurar la pasarela de Make (${r.status}).`);
  }
  if (found && !found.isActive) await makeActivateScenario({ workspaceId, scenarioId: id }).catch(() => undefined);
  if (!found) await makeActivateScenario({ workspaceId, scenarioId: id });
  cache.set(key, { id, at: Date.now() });
  return id;
}

function parseBody(b: unknown): any {
  if (typeof b !== "string") return b ?? {};
  try {
    return JSON.parse(b);
  } catch {
    return b;
  }
}

/** Llamada a una API de Google Business Profile vía Make. Devuelve el JSON de Google. */
export async function gbpViaMake(
  workspaceId: string,
  req: { domain: string; method?: string; url: string; body?: unknown; connId?: number | null }
): Promise<any> {
  const id = await ensureGateway(workspaceId, req.connId);
  const r = await makeRawCall({
    workspaceId,
    method: "POST",
    path: `/scenarios/${id}/run`,
    body: {
      responsive: true,
      data: { domain: req.domain, method: req.method ?? "GET", url: req.url, body: req.body == null ? "" : JSON.stringify(req.body) }
    }
  });
  if (!r.ok) {
    if (r.status === 404) for (const k of cache.keys()) if (k.startsWith(`${workspaceId}:`)) cache.delete(k);
    throw new MakeGatewayError(`Make ${r.status}: ${String(r.responseText).slice(0, 300)}`);
  }
  let outputs = r.data?.outputs;
  if (!outputs && r.data?.executionId) {
    // Algunas zonas devuelven sólo el id de ejecución: se leen las salidas de la ejecución.
    const ex = await makeRawCall({ workspaceId, method: "GET", path: `/scenarios/${id}/executions/${r.data.executionId}` });
    outputs = ex.data?.outputs ?? ex.data?.execution?.outputs;
  }
  if (!outputs) throw new MakeGatewayError("La pasarela de Make no devolvió datos (revisa el escenario «" + gatewayName(req.connId ?? 0) + "»).");
  const status = Number(outputs.status ?? 200);
  const body = parseBody(outputs.body);
  if (status >= 400) throw new MakeGatewayError(`Google ${status} vía Make: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}
