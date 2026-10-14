import "server-only";
import { prisma } from "@/lib/prisma";
import { patchWorkspaceSettings } from "@/lib/content/settings";
import { readModules } from "@/lib/modules";
import { readSettings, type WorkspaceSettings } from "@/lib/settings";
import {
  normalizeForwardTargets,
  normalizeStatuses,
  randomIntakeToken,
  readLeadsConfig,
  type ForwardTarget,
  type LeadsConfig,
  type LeadStatus,
} from "@/lib/leads/config";

export type LeadsState = LeadsConfig & { enabled: boolean };

export async function getLeadsState(workspaceId: string): Promise<LeadsState> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const settings = readSettings(ws?.settings);
  return {
    enabled: readModules(ws?.settings).leads,
    ...readLeadsConfig(ws?.settings, settings.whatsapp.countryCode || "34"),
  };
}

// Guarda estados y/o destinos conservando el resto de settings (transacción FOR UPDATE).
export async function saveLeadsConfig(
  workspaceId: string,
  patch: { statuses?: LeadStatus[]; forwardTargets?: ForwardTarget[]; regenerateToken?: boolean }
): Promise<LeadsConfig> {
  const saved = await patchWorkspaceSettings(workspaceId, (settings) => {
    const countryCode = readSettings(settings).whatsapp.countryCode || "34";
    const current = readLeadsConfig(settings, countryCode);
    settings.leads = {
      statuses: patch.statuses ? normalizeStatuses(patch.statuses) : current.statuses,
      forwardTargets: patch.forwardTargets ? normalizeForwardTargets(patch.forwardTargets, countryCode) : current.forwardTargets,
      intakeToken: patch.regenerateToken || !current.intakeToken ? randomIntakeToken() : current.intakeToken,
    };
  });
  return readLeadsConfig(saved, readSettings(saved).whatsapp.countryCode || "34");
}

// El token de entrada de Make se crea la primera vez que se pide.
export async function ensureIntakeToken(workspaceId: string): Promise<string> {
  const state = await getLeadsState(workspaceId);
  if (state.intakeToken) return state.intakeToken;
  return (await saveLeadsConfig(workspaceId, {})).intakeToken;
}

export async function findWorkspaceByLeadsToken(
  token: string
): Promise<{ id: string; settings: WorkspaceSettings; leads: LeadsState } | null> {
  if (!token || token.length < 24 || token.length > 100) return null;
  const rows = await prisma.workspace.findMany({
    where: { settings: { path: ["leads", "intakeToken"], equals: token }, isBlocked: false },
    select: { id: true, settings: true },
    take: 1,
  });
  const ws = rows[0];
  if (!ws) return null;
  const settings = readSettings(ws.settings);
  return {
    id: ws.id,
    settings,
    leads: { enabled: readModules(ws.settings).leads, ...readLeadsConfig(ws.settings, settings.whatsapp.countryCode || "34") },
  };
}
