/**
 * POST /api/v1/gmb/clients/[id]/create-scenario
 * Clona la plantilla de Make (settings.integrations.gmb.makeTemplateId),
 * inyecta account/location de la ficha + las conexiones (GMB/OpenAI/Gmail/
 * Sheets), crea el escenario, lo activa y guarda su id en la ficha.
 * Requiere Make configurado en /admin/make-settings + los IDs en Ajustes GMB.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { makeGetBlueprint, makeCreateScenario, makeActivateScenario } from "@/lib/integrations/make";
import { logGmbActivity } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "admin" }, async (_req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  const templateId = g.makeTemplateId;
  if (!templateId) throw new ApiError(400, "no_template", "Falta el Template Scenario ID en Ajustes de GMB Hub.");

  const conns = {
    gmb: g.makeGmbConn ? Number(g.makeGmbConn) : null,
    openai: g.makeOpenaiConn ? Number(g.makeOpenaiConn) : null,
    gmail: g.makeGmailAcct ? Number(g.makeGmailAcct) : null,
    sheets: g.makeSheetsConn ? Number(g.makeSheetsConn) : null
  };

  let blueprint: any;
  try {
    blueprint = await makeGetBlueprint({ workspaceId: api.workspaceId, scenarioId: Number(templateId) });
  } catch (e: any) {
    throw new ApiError(502, "make_error", `No pude leer la plantilla de Make: ${String(e?.message ?? e)}`);
  }

  injectClientParams(blueprint, {
    account: client.accountId,
    location: client.locationId,
    conns
  });

  let scenario: { id: number; name: string };
  try {
    scenario = await makeCreateScenario({
      workspaceId: api.workspaceId,
      name: `GMB Reviews - ${client.name}`,
      blueprint,
      scheduling: { type: "indefinitely", interval: Math.max(5, client.frequency || 15) * 60 }
    });
    await makeActivateScenario({ workspaceId: api.workspaceId, scenarioId: scenario.id }).catch(() => {});
  } catch (e: any) {
    throw new ApiError(502, "make_error", `No pude crear el escenario: ${String(e?.message ?? e)}`);
  }

  await prisma.gmbClient.update({ where: { id: client.id }, data: { scenarioId: String(scenario.id) } });
  await logGmbActivity({
    workspaceId: api.workspaceId,
    clientId: client.id,
    actionType: "scenario_created",
    description: `Escenario Make #${scenario.id} creado para ${client.name}`
  }).catch(() => {});

  return NextResponse.json({ ok: true, scenarioId: scenario.id, name: scenario.name });
});

/** Inyecta account/location y las conexiones en los módulos del blueprint. */
function injectClientParams(
  blueprint: any,
  ctx: { account: string; location: string; conns: { gmb: number | null; openai: number | null; gmail: number | null; sheets: number | null } }
) {
  const flow = blueprint?.flow;
  if (!Array.isArray(flow)) return;
  for (const mod of flow) {
    const mid: string = mod?.module ?? "";
    if (mid.includes("google-my-business")) {
      if (mod.parameters && ctx.conns.gmb && mod.parameters.__IMTCONN__ != null) mod.parameters.__IMTCONN__ = ctx.conns.gmb;
      if (mod.mapper) {
        if ("account" in mod.mapper) mod.mapper.account = ctx.account;
        if ("location" in mod.mapper) mod.mapper.location = ctx.location;
      }
    }
    if (mid.includes("openai") && ctx.conns.openai && mod.parameters?.__IMTCONN__ != null) mod.parameters.__IMTCONN__ = ctx.conns.openai;
    if (mid.includes("gmail") && ctx.conns.gmail && mod.parameters?.__IMTCONN__ != null) mod.parameters.__IMTCONN__ = ctx.conns.gmail;
    if (mid.includes("google-sheets") && ctx.conns.sheets && mod.parameters?.__IMTCONN__ != null) mod.parameters.__IMTCONN__ = ctx.conns.sheets;
    if (Array.isArray(mod.routes)) {
      for (const route of mod.routes) {
        if (route?.flow) injectClientParams({ flow: route.flow }, ctx);
      }
    }
  }
}
