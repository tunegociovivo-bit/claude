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
import { makeActivateScenario, makeCreateScenario, makeDefaultTeamId, makeListScenarios, makeRawCall } from "@/lib/integrations/make";

/**
 * Un escenario pasarela por conexión de Make (cada cuenta de Google de cliente tiene la suya).
 * v2: webhook + «Webhook response» (respuesta síncrona fiable). La v1 «on-demand» con «Return
 * output» no devolvía las salidas por la API de Make.
 */
export const gatewayName = (connId: number) => `HUB · Pasarela GBP (webhook) · conexión ${connId} (no borrar)`;

export const GBP_DOMAINS = {
  accounts: "https://mybusinessaccountmanagement.googleapis.com",
  info: "https://mybusinessbusinessinformation.googleapis.com",
  v4: "https://mybusiness.googleapis.com"
} as const;

export class MakeGatewayError extends Error {}


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

/** Mensaje de error de Google, codificado para que quepa en un string JSON (el Hub lo decodifica). */
const ERR = "{{encodeURL(2.error.message)}}";

export function gatewayBlueprint(connId: number, hookId: number) {
  const json = [{ key: "Content-Type", value: "application/json" }];
  return {
    name: gatewayName(connId),
    metadata: { version: 1 },
    flow: [
      { id: 1, module: "gateway:CustomWebHook", version: 1, parameters: { hook: hookId, maxResults: 1 }, mapper: {} },
      {
        id: 2,
        module: "google-my-business:makeApiCall",
        version: 1,
        parameters: { __IMTCONN__: connId },
        mapper: { domain: "{{1.domain}}", method: "{{1.method}}", url: "{{1.url}}", body: "{{1.body}}" },
        // Si Google responde con error, se devuelve el mensaje al Hub y la ejecución no cuenta como
        // fallo (así Make no desactiva el escenario por errores seguidos).
        onerror: [
          { id: 5, module: "gateway:WebhookRespond", version: 1, parameters: {}, mapper: { status: "200", body: `{"status":599,"error":"${ERR}"}`, headers: json } },
          { id: 6, module: "builtin:Ignore", version: 1, parameters: {}, mapper: {} }
        ]
      },
      { id: 3, module: "json:TransformToJSON", version: 1, parameters: {}, mapper: { object: "{{2.body}}" } },
      {
        id: 4,
        module: "gateway:WebhookRespond",
        version: 1,
        parameters: {},
        mapper: { status: "200", body: '{"status":{{ifempty(2.statusCode; 200)}},"body":{{ifempty(3.json; "null")}}}', headers: json }
      }
    ]
  };
}

const cache = new Map<string, { url: string; at: number }>();

/** URL del webhook pasarela de una conexión (lo busca por nombre o crea webhook + escenario y lo activa). */
export async function ensureGateway(workspaceId: string, connId?: number | null): Promise<string> {
  const conn = connId ?? (await gmbConnId(workspaceId));
  if (!conn) throw new MakeGatewayError("Falta la conexión de Google Business Profile de Make en Ajustes del GMB Hub.");
  const key = `${workspaceId}:${conn}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < 3_600_000) return c.url;
  const name = gatewayName(conn);
  const found = (await makeListScenarios({ workspaceId, query: "Pasarela GBP (webhook)" })).find((s) => s.name === name);
  let url = "";
  if (found) {
    const sc = await makeRawCall({ workspaceId, method: "GET", path: `/scenarios/${found.id}` });
    const hookId = Number(sc.data?.scenario?.hookId ?? sc.data?.hookId);
    if (hookId) {
      const h = await makeRawCall({ workspaceId, method: "GET", path: `/hooks/${hookId}` });
      url = String(h.data?.hook?.url ?? h.data?.url ?? "");
    }
    if (!found.isActive) await makeActivateScenario({ workspaceId, scenarioId: found.id }).catch(() => undefined);
  }
  if (!url) {
    const teamId = await makeDefaultTeamId(workspaceId);
    const h = await makeRawCall({
      workspaceId,
      method: "POST",
      path: "/hooks",
      // La API de Make exige method/headers/stringify en el nivel superior (no dentro de "data").
      body: { name: `HUB · Pasarela GBP · conexión ${conn}`, teamId, typeName: "gateway-webhook", method: false, headers: false, stringify: false }
    });
    const hook = h.data?.hook ?? h.data;
    if (!h.ok || !hook?.id || !hook?.url) throw new MakeGatewayError(`No se pudo crear el webhook de la pasarela en Make (${h.status}): ${String(h.responseText).slice(0, 200)}`);
    const s = await makeCreateScenario({ workspaceId, teamId, name, blueprint: gatewayBlueprint(conn, Number(hook.id)), scheduling: { type: "immediately" } });
    await makeActivateScenario({ workspaceId, scenarioId: s.id });
    url = String(hook.url);
  }
  cache.set(key, { url, at: Date.now() });
  return url;
}

/** Llamada a una API de Google Business Profile vía Make. Devuelve el JSON de Google. */
export async function gbpViaMake(
  workspaceId: string,
  req: { domain: string; method?: string; url: string; body?: unknown; connId?: number | null }
): Promise<any> {
  const hookUrl = await ensureGateway(workspaceId, req.connId);
  let res: Response;
  try {
    res = await fetch(hookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: req.domain, method: req.method ?? "GET", url: req.url, body: req.body == null ? "" : JSON.stringify(req.body) }),
      signal: AbortSignal.timeout(45_000)
    });
  } catch (e) {
    throw new MakeGatewayError(`La pasarela de Make no respondió: ${(e as Error).message}`);
  }
  const text = await res.text();
  let out: any = null;
  try {
    out = JSON.parse(text);
  } catch {
    // «Accepted» = el escenario no está activo o no respondió; 410/404 = webhook borrado.
    for (const k of cache.keys()) if (k.startsWith(`${workspaceId}:`)) cache.delete(k);
    throw new MakeGatewayError(`La pasarela de Make no devolvió datos (${res.status}: ${text.slice(0, 120)}).`);
  }
  const status = Number(out?.status ?? 200);
  if (status === 599) {
    let msg = String(out?.error ?? "");
    try {
      msg = decodeURIComponent(msg);
    } catch {
      /* se deja tal cual */
    }
    throw new MakeGatewayError(`Google rechazó la petición: ${msg.slice(0, 300)}`);
  }
  if (status >= 400) throw new MakeGatewayError(`Google ${status} vía Make: ${JSON.stringify(out?.body).slice(0, 300)}`);
  return out?.body ?? {};
}
