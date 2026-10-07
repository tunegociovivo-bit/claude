/**
 * Automatización de reseñas en Make para una ficha: clona la plantilla de Ajustes GMB
 * (settings.integrations.gmb.makeTemplateId) y la adapta a la ficha:
 *  - cuenta/ubicación en los módulos de Google Business Profile (en `parameters` —p. ej. el
 *    disparador «Watch Reviews»— y en `mapper`),
 *  - la conexión de Make de la cuenta de Google de la ficha (si la tiene) o la de Ajustes,
 *  - el envío de cada reseña al webhook del Hub con token, workspace y ficha.
 */
import { prisma } from "@/lib/db/prisma";
import { makeActivateScenario, makeCreateScenario, makeGetBlueprint } from "@/lib/integrations/make";
import { gmbLocationPath } from "@/lib/integrations/gmb";
import { getGmbConfig, logGmbActivity } from "@/lib/integrations/gmb-hub";
import { baseUrl } from "@/lib/gmb/gbp-oauth";

export type ScenarioCtx = {
  account: string;
  location: string;
  conns: { gmb: number | null; openai: number | null; gmail: number | null; sheets: number | null };
  webhook: { url: string; body: string } | null;
};

/** Cuerpo JSON que Make envía al webhook del Hub. El comentario va al final (lo tolera el webhook aunque traiga comillas). */
export function webhookBody(token: string, workspaceId: string, clientId: string, location: string): string {
  return (
    `{"token":"${token}","workspaceId":"${workspaceId}","clientId":"${clientId}","location_id":"${location}",` +
    `"review_id":"{{1.reviewId}}","author_name":"{{1.reviewer.displayName}}","rating":"{{1.starRating}}",` +
    `"review_time":"{{1.createTime}}","update_time":"{{1.updateTime}}","comment":"{{1.comment}}"}`
  );
}

/** Adapta el blueprint (recursivo en routers). */
export function injectClientParams(blueprint: any, ctx: ScenarioCtx) {
  const flow = blueprint?.flow;
  if (!Array.isArray(flow)) return;
  for (const mod of flow) {
    const mid: string = mod?.module ?? "";
    if (mid.includes("google-my-business")) {
      if (ctx.conns.gmb) {
        mod.parameters = mod.parameters ?? {};
        if ("__IMTCONN__" in mod.parameters) mod.parameters.__IMTCONN__ = ctx.conns.gmb;
      }
      for (const box of [mod.parameters, mod.mapper]) {
        if (!box || typeof box !== "object") continue;
        if ("account" in box) box.account = ctx.account;
        if ("location" in box) box.location = ctx.location;
      }
      // Las etiquetas guardadas en metadata (nombre de la ficha de la plantilla) ya no aplican.
      if (mod.metadata?.restore?.parameters) {
        delete mod.metadata.restore.parameters.account;
        delete mod.metadata.restore.parameters.location;
      }
    }
    if (mid.includes("openai") && ctx.conns.openai && mod.parameters?.__IMTCONN__ != null) mod.parameters.__IMTCONN__ = ctx.conns.openai;
    if (mid.includes("gmail") || mid.includes("google-email")) {
      if (ctx.conns.gmail && mod.parameters && "account" in mod.parameters && typeof mod.parameters.account === "number") mod.parameters.account = ctx.conns.gmail;
      if (ctx.conns.gmail && mod.parameters?.__IMTCONN__ != null) mod.parameters.__IMTCONN__ = ctx.conns.gmail;
    }
    if (mid.includes("google-sheets") && ctx.conns.sheets && mod.parameters?.__IMTCONN__ != null) mod.parameters.__IMTCONN__ = ctx.conns.sheets;
    if (mid.startsWith("http:") && ctx.webhook && mod.mapper && /reviews\/webhook|gmb-hub/.test(String(mod.mapper.url ?? ""))) {
      mod.mapper.url = ctx.webhook.url;
      mod.mapper.method = "post";
      mod.mapper.contentType = "json";
      mod.mapper.inputMethod = "jsonString";
      mod.mapper.jsonStringBodyContent = ctx.webhook.body;
    }
    if (Array.isArray(mod.routes)) for (const route of mod.routes) if (route?.flow) injectClientParams({ flow: route.flow }, ctx);
  }
}

export async function createReviewsScenario(workspaceId: string, clientId: string, origin?: string): Promise<{ id: number; name: string }> {
  const client = await prisma.gmbClient.findFirst({ where: { id: clientId, workspaceId } });
  if (!client) throw new Error("Ficha no encontrada");
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  if (!g.makeTemplateId) throw new Error("Falta el Template Scenario ID en Ajustes de GMB Hub.");
  const location = gmbLocationPath(client.accountId, client.locationId);
  if (!location) throw new Error("La ficha no tiene cuenta/ubicación de Google vinculada.");
  const account = location.split("/locations/")[0];
  const cfg = await getGmbConfig(workspaceId);
  const hub = baseUrl(origin) || "https://hub.negociovivo.app";
  const ctx: ScenarioCtx = {
    account,
    location,
    conns: {
      gmb: Number(client.connectionId) > 0 ? Number(client.connectionId) : g.makeGmbConn ? Number(g.makeGmbConn) : null,
      openai: g.makeOpenaiConn ? Number(g.makeOpenaiConn) : null,
      gmail: g.makeGmailAcct ? Number(g.makeGmailAcct) : null,
      sheets: g.makeSheetsConn ? Number(g.makeSheetsConn) : null
    },
    webhook: cfg.ingestToken ? { url: `${hub}/api/v1/gmb/reviews/webhook`, body: webhookBody(cfg.ingestToken, workspaceId, client.id, location) } : null
  };
  const blueprint = await makeGetBlueprint({ workspaceId, scenarioId: Number(g.makeTemplateId) });
  injectClientParams(blueprint, ctx);
  const scenario = await makeCreateScenario({
    workspaceId,
    name: `GMB Reviews - ${client.name}`,
    blueprint,
    scheduling: { type: "indefinitely", interval: Math.max(5, client.frequency || 15) * 60 }
  });
  await makeActivateScenario({ workspaceId, scenarioId: scenario.id }).catch(() => {});
  await prisma.gmbClient.updateMany({ where: { id: client.id, workspaceId }, data: { scenarioId: String(scenario.id) } });
  await logGmbActivity({
    workspaceId,
    clientId: client.id,
    actionType: "scenario_created",
    description: `Escenario Make #${scenario.id} creado para ${client.name}`
  }).catch(() => {});
  return { id: scenario.id, name: scenario.name };
}
