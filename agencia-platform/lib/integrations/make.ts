/**
 * Cliente Make.com (antes Integromat) — REST API v2.
 *
 * Auth: header `Authorization: Token <apiToken>`. El token se obtiene
 * en https://www.make.com/en/help/api → API Tokens → New token.
 * Necesita scopes:
 *   - scenarios:read + scenarios:write
 *   - teams:read
 *   - connections:read
 *
 * Zona: Make tiene varias regiones (eu1, eu2, us1, us2). El token
 * solo funciona en su zona. Por defecto eu1, configurable per workspace.
 *
 * Config: Workspace.settings.integrations.make = {
 *   apiTokenEnc: string (cifrado),
 *   zone: "eu1" | "eu2" | "us1" | "us2",
 *   teamId?: number  (default si la organización solo tiene 1)
 * }
 *
 * Recursos típicos del flujo "duplicar escenario":
 *   1. listScenarios para encontrar el origen
 *   2. getBlueprint del origen → JSON con todos los modules
 *   3. (en código del agente) reemplazar formId del módulo Facebook
 *      Leads Ads + destinatarios del módulo email
 *   4. createScenario con el blueprint modificado
 *   5. activateScenario para que arranque
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

type MakeConfig = {
  apiToken: string;
  zone: string;
  teamId: number | null;
};

async function getConfig(workspaceId: string): Promise<MakeConfig> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const cfg = (ws?.settings as any)?.integrations?.make;
  if (!cfg?.apiTokenEnc) {
    throw new Error(
      "Make no configurado. Pega el API token en /admin/make-settings."
    );
  }
  const apiToken = decryptSecret(cfg.apiTokenEnc);
  if (!apiToken) throw new Error("Make API token inválido (decrypt fallo)");
  return {
    apiToken,
    zone: cfg.zone || "eu1",
    teamId: typeof cfg.teamId === "number" ? cfg.teamId : null
  };
}

function baseUrl(zone: string): string {
  return `https://${zone}.make.com/api/v2`;
}

async function makeFetch<T = any>(
  workspaceId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const cfg = await getConfig(workspaceId);
  const url = path.startsWith("http") ? path : `${baseUrl(cfg.zone)}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Token ${cfg.apiToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Make ${r.status} ${path}: ${t.slice(0, 400)}`);
  }
  return r.json();
}

// ────────────────────────────────────────────────────────────────────
// TEAMS / FOLDERS
// ────────────────────────────────────────────────────────────────────

/** Lista las organizations del usuario dueño del token. */
export async function makeListOrganizations(
  workspaceId: string
): Promise<Array<{ id: number; name: string }>> {
  const data = await makeFetch<any>(workspaceId, `/organizations`);
  return (data.organizations ?? []).map((o: any) => ({
    id: o.id,
    name: o.name
  }));
}

export async function makeListTeams(workspaceId: string): Promise<Array<{
  id: number;
  name: string;
  organizationId: number;
}>> {
  // Make API v2 requiere organizationId en /teams. Iteramos sobre TODAS
  // las orgs del usuario y acumulamos teams.
  const orgs = await makeListOrganizations(workspaceId);
  const out: Array<{ id: number; name: string; organizationId: number }> = [];
  for (const org of orgs) {
    const data = await makeFetch<any>(
      workspaceId,
      `/teams?organizationId=${org.id}`
    );
    for (const t of data.teams ?? []) {
      out.push({ id: t.id, name: t.name, organizationId: org.id });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// SCENARIOS
// ────────────────────────────────────────────────────────────────────

export async function makeListScenarios(opts: {
  workspaceId: string;
  teamId?: number;
  query?: string;
  pageSize?: number;
}): Promise<Array<{
  id: number;
  name: string;
  isActive: boolean;
  folderId: number | null;
  teamId: number;
  description: string | null;
  scheduling: any;
}>> {
  const cfg = await getConfig(opts.workspaceId);
  const teamId = opts.teamId ?? cfg.teamId;
  if (!teamId) {
    throw new Error(
      "teamId requerido. Llama primero make_list_teams o configura un team default."
    );
  }
  const params = new URLSearchParams({ teamId: String(teamId) });
  if (opts.pageSize) params.set("pg[limit]", String(opts.pageSize));
  if (opts.query) params.set("filter[name]", opts.query);
  const data = await makeFetch<any>(
    opts.workspaceId,
    `/scenarios?${params.toString()}`
  );
  return (data.scenarios ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    isActive: !!s.isActive,
    folderId: s.folderId ?? null,
    teamId: s.teamId,
    description: s.description ?? null,
    scheduling: s.scheduling
  }));
}

export async function makeGetScenario(opts: {
  workspaceId: string;
  scenarioId: number;
}): Promise<any> {
  const data = await makeFetch<any>(opts.workspaceId, `/scenarios/${opts.scenarioId}`);
  return data.scenario ?? data;
}

/**
 * Devuelve el blueprint JSON completo del escenario — incluye todos
 * los módulos, su configuración, conexiones, mapeos. Es lo que hace
 * falta para clonar/modificar.
 */
export async function makeGetBlueprint(opts: {
  workspaceId: string;
  scenarioId: number;
}): Promise<any> {
  const data = await makeFetch<any>(
    opts.workspaceId,
    `/scenarios/${opts.scenarioId}/blueprint`
  );
  // Make devuelve { response: { blueprint: {...} } } o { blueprint: {...} }
  return data.response?.blueprint ?? data.blueprint ?? data;
}

export async function makeCreateScenario(opts: {
  workspaceId: string;
  teamId?: number;
  name?: string;
  /** Blueprint completo. Si lo modificaste (ej. cambiaste formId,
   *  destinos email, etc), pásalo con los cambios aplicados. */
  blueprint: any;
  /** Scheduling. Default "immediately" (corre cuando hay datos). */
  scheduling?: any;
  folderId?: number;
}): Promise<{ id: number; name: string; isActive: boolean }> {
  const cfg = await getConfig(opts.workspaceId);
  const teamId = opts.teamId ?? cfg.teamId;
  if (!teamId) throw new Error("teamId requerido");
  const body: any = {
    blueprint: JSON.stringify(opts.blueprint),
    scheduling: JSON.stringify(opts.scheduling ?? { type: "immediately" }),
    teamId
  };
  if (opts.name) body.name = opts.name;
  if (opts.folderId) body.folderId = opts.folderId;
  const data = await makeFetch<any>(opts.workspaceId, `/scenarios`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  const s = data.scenario ?? data;
  return { id: s.id, name: s.name, isActive: !!s.isActive };
}

/**
 * Actualiza el blueprint de un escenario existente (o su nombre,
 * scheduling). Útil para tunear sin recrear desde cero.
 */
export async function makeUpdateScenario(opts: {
  workspaceId: string;
  scenarioId: number;
  blueprint?: any;
  name?: string;
  scheduling?: any;
}): Promise<{ id: number; name: string }> {
  const body: any = {};
  if (opts.blueprint) body.blueprint = JSON.stringify(opts.blueprint);
  if (opts.name) body.name = opts.name;
  if (opts.scheduling) body.scheduling = JSON.stringify(opts.scheduling);
  const data = await makeFetch<any>(opts.workspaceId, `/scenarios/${opts.scenarioId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  const s = data.scenario ?? data;
  return { id: s.id, name: s.name };
}

export async function makeActivateScenario(opts: {
  workspaceId: string;
  scenarioId: number;
}): Promise<{ ok: true }> {
  await makeFetch(opts.workspaceId, `/scenarios/${opts.scenarioId}/start`, {
    method: "POST"
  });
  return { ok: true };
}

export async function makeDeactivateScenario(opts: {
  workspaceId: string;
  scenarioId: number;
}): Promise<{ ok: true }> {
  await makeFetch(opts.workspaceId, `/scenarios/${opts.scenarioId}/stop`, {
    method: "POST"
  });
  return { ok: true };
}

/**
 * Test de conexión: lista teams. Devuelve count. Si tira excepción,
 * el token no vale.
 */
export async function makeTest(workspaceId: string): Promise<{ teams: number }> {
  const teams = await makeListTeams(workspaceId);
  return { teams: teams.length };
}
