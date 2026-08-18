/**
 * Scheduler del PILOTO AUTOMÁTICO (tenant-scoped). Aplica el plan puro (planAutopilot) a las acciones
 * de la ficha: genera oportunidades por reglas, auto-avanza SOLO efectos internos reversibles
 * permitidos (via execute-safe) y lleva las externas a needs_approval. Idempotente, acotado por
 * límite diario, con kill switch, quiet hours y confianza mínima. Registra motivos.
 */
import { computeActionTransition, computeActionPriority, OPEN_ACTION_STATUSES, type ActionStatus } from "./actions";
import { planAutopilot, type AutopilotPolicy, type AutopilotAction } from "./autopilot";
import { applySafeEffect } from "./execute-safe";
import { computePresenceScore } from "./presence-score";
import { gatherPresenceInput, citationStats, buildRuleOpportunities } from "./server";

type PrismaLike = any;
const AUTOPILOT_ACTOR = "autopilot";

function policyFromRow(p: any): AutopilotPolicy {
  return { mode: p.mode, dailyLimit: p.dailyLimit, quietStart: p.quietStart, quietEnd: p.quietEnd, minConfidence: p.minConfidence, allowedModules: Array.isArray(p.allowedModules) ? p.allowedModules : null, killSwitch: !!p.killSwitch, executedToday: p.executedToday ?? 0, executedDate: p.executedDate ?? null };
}

/** Genera oportunidades por reglas (dedupe contra abiertas). Devuelve nº creadas. */
async function generateOpportunities(prisma: PrismaLike, workspaceId: string, client: any): Promise<number> {
  const input = await gatherPresenceInput(prisma, workspaceId, client);
  const score = computePresenceScore(input);
  const cites = await citationStats(prisma, workspaceId, client.id);
  const opps = buildRuleOpportunities(input, score.breakdown, cites);
  const open = await prisma.gmbAction.findMany({ where: { workspaceId, clientId: client.id, status: { in: OPEN_ACTION_STATUSES } }, select: { type: true } });
  const openTypes = new Set(open.map((a: any) => a.type));
  let created = 0;
  for (const o of opps) {
    if (openTypes.has(o.type)) continue;
    await prisma.gmbAction.create({ data: { workspaceId, clientId: client.id, module: o.module, type: o.type, title: o.title, description: o.description, impact: o.impact, effort: o.effort, confidence: o.confidence, priority: o.priority, evidence: o.evidence, status: "suggested", requiresApproval: o.requiresApproval, external: o.external, source: "rule", createdById: AUTOPILOT_ACTOR } });
    openTypes.add(o.type);
    created++;
  }
  return created;
}

async function autoAdvance(prisma: PrismaLike, workspaceId: string, action: any, commands: string[], now: Date): Promise<{ executed: boolean; done: boolean; error?: string }> {
  let status: ActionStatus = action.status;
  for (const cmd of commands) {
    if (cmd === "complete") continue;
    if (cmd === "execute") {
      const eff = await applySafeEffect(prisma, workspaceId, { id: action.id, clientId: action.clientId, module: action.module, type: action.type, title: action.title, external: action.external, evidence: action.evidence, result: action.result }, AUTOPILOT_ACTOR);
      if (eff.ok) { await prisma.gmbAction.updateMany({ where: { id: action.id, workspaceId }, data: { status: "done", result: { ...eff.result, autopilot: true } } }); return { executed: true, done: true }; }
      await prisma.gmbAction.updateMany({ where: { id: action.id, workspaceId }, data: { status: "error", lastError: eff.error ?? "error" } });
      return { executed: false, done: false, error: eff.error };
    }
    const t = computeActionTransition({ status, external: action.external, requiresApproval: action.requiresApproval }, cmd as any, { actorId: AUTOPILOT_ACTOR });
    if (!t.ok) return { executed: false, done: false, error: t.error };
    status = t.next!;
    const data: any = { status };
    if (cmd === "approve") { data.approvedById = AUTOPILOT_ACTOR; data.approvedAt = now; }
    await prisma.gmbAction.updateMany({ where: { id: action.id, workspaceId }, data });
  }
  return { executed: false, done: false };
}

/** Ejecuta el piloto para una ficha. `generate` crea oportunidades primero. Devuelve resumen+motivos. */
export async function runAutopilotForClient(prisma: PrismaLike, workspaceId: string, clientId: string, opts: { now?: Date; generate?: boolean } = {}): Promise<{ active: boolean; reason?: string; generated: number; executed: number; advanced: number; skipped: any[] }> {
  const now = opts.now ?? new Date();
  const todayISO = now.toISOString().slice(0, 10);
  const hour = now.getHours();
  const client = await prisma.gmbClient.findFirst({ where: { id: clientId, workspaceId } });
  const policyRow = await prisma.gmbAutopilotPolicy.findFirst({ where: { workspaceId, clientId } });
  if (!client || !policyRow) return { active: false, reason: "sin_politica", generated: 0, executed: 0, advanced: 0, skipped: [] };
  const policy = policyFromRow(policyRow);

  // Generación (si procede) antes de planificar.
  let generated = 0;
  if (opts.generate && policy.mode !== "suggest_only" && !policy.killSwitch) generated = await generateOpportunities(prisma, workspaceId, client);

  const actionsRows = await prisma.gmbAction.findMany({ where: { workspaceId, clientId, status: { in: OPEN_ACTION_STATUSES } }, orderBy: { priority: "desc" }, take: 50 });
  const actions: AutopilotAction[] = actionsRows.map((a: any) => ({ id: a.id, status: a.status, external: a.external, module: a.module, confidence: a.confidence }));
  const plan = planAutopilot({ policy, actions, hour, todayISO });
  if (!plan.active) return { active: false, reason: plan.reason, generated, executed: 0, advanced: 0, skipped: plan.skipped };

  let executed = 0, advanced = 0;
  for (const step of plan.toAdvance) {
    const row = actionsRows.find((a: any) => a.id === step.actionId);
    if (!row) continue;
    const r = await autoAdvance(prisma, workspaceId, row, step.commands, now);
    if (r.executed) executed++;
    advanced++;
  }

  // Contador diario + auditoría de la corrida.
  const newExecutedToday = (policy.executedDate === todayISO ? policy.executedToday : 0) + executed;
  await prisma.gmbAutopilotPolicy.updateMany({ where: { id: policyRow.id, workspaceId }, data: { executedToday: newExecutedToday, executedDate: todayISO, lastRunAt: now } });
  return { active: true, generated, executed, advanced, skipped: plan.skipped };
}

/** Worker de cron: corre el piloto para todas las fichas con política activa (no suggest_only, sin
 *  kill switch), throttled a una generación por día (por lastRunAt). Tenant-scoped por construcción. */
export async function processAllAutopilot(prisma: PrismaLike, opts: { now?: Date; maxClients?: number } = {}): Promise<{ clients: number; executed: number }> {
  const now = opts.now ?? new Date();
  const todayISO = now.toISOString().slice(0, 10);
  const policies = await prisma.gmbAutopilotPolicy.findMany({ where: { killSwitch: false, mode: { not: "suggest_only" } }, take: opts.maxClients ?? 100, select: { workspaceId: true, clientId: true, lastRunAt: true } });
  let executed = 0, count = 0;
  for (const p of policies) {
    // Genera una vez al día; el resto de ticks solo avanza lo pendiente.
    const generate = !p.lastRunAt || new Date(p.lastRunAt).toISOString().slice(0, 10) !== todayISO;
    try {
      const r = await runAutopilotForClient(prisma, p.workspaceId, p.clientId, { now, generate });
      executed += r.executed;
      count++;
    } catch (e: any) {
      console.warn(`[gmb-autopilot] ws=${p.workspaceId} client=${p.clientId} FALLO: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  return { clients: count, executed };
}
