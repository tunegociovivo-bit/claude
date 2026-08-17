/**
 * Generación de ALERTAS (idempotente, tenant-scoped, auto-sanadora). Por cada ficha calcula señales,
 * evalúa reglas y:
 *   - crea alertas nuevas (dedup por dedupKey mientras haya una abierta/ack),
 *   - RESUELVE automáticamente las abiertas cuya condición ya no se cumple.
 * Webhooks ADAPTER-GATED: si la regla trae webhookUrl, se hace un POST REAL; si no, alerta interna.
 * Nunca se simula un envío externo.
 */
import { evaluateAlerts, type AlertRules, type AlertType, type AlertSeverity } from "./alerts";
import { clientSignals } from "./agency-data";

type PrismaLike = any;

async function rulesForClient(prisma: PrismaLike, workspaceId: string, clientId: string): Promise<{ rules: AlertRules; webhookByType: Map<AlertType, string> }> {
  const rows = await prisma.gmbAlertRule.findMany({ where: { workspaceId, OR: [{ clientId: null }, { clientId }] } });
  const rules: AlertRules = {};
  const webhookByType = new Map<AlertType, string>();
  // globales primero, luego overrides de la ficha
  for (const r of rows.sort((a: any, b: any) => (a.clientId ? 1 : 0) - (b.clientId ? 1 : 0))) {
    rules[r.type as AlertType] = { enabled: r.enabled, severity: (r.severity as AlertSeverity) ?? undefined, threshold: r.threshold ?? undefined };
    if (r.webhookUrl) webhookByType.set(r.type as AlertType, r.webhookUrl);
  }
  return { rules, webhookByType };
}

async function notifyWebhook(url: string, payload: any): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function generateAlertsForClient(prisma: PrismaLike, workspaceId: string, clientId: string, now: Date = new Date()): Promise<{ created: number; resolved: number }> {
  const signals = await clientSignals(prisma, workspaceId, clientId, now);
  const { rules, webhookByType } = await rulesForClient(prisma, workspaceId, clientId);
  const candidates = evaluateAlerts(clientId, signals, rules);
  const candidateKeys = new Set(candidates.map((c) => c.dedupKey));

  const existing = await prisma.gmbAlert.findMany({ where: { workspaceId, clientId, status: { in: ["open", "ack"] } }, select: { id: true, dedupKey: true } });
  const existingKeys = new Set(existing.map((e: any) => e.dedupKey));

  let created = 0, resolved = 0;
  for (const c of candidates) {
    if (existingKeys.has(c.dedupKey)) continue; // dedup: ya hay una abierta
    await prisma.gmbAlert.create({ data: { workspaceId, clientId, type: c.type, severity: c.severity, title: c.title, body: c.body, dedupKey: c.dedupKey, deepLink: c.deepLink, data: c.data, status: "open" } });
    created++;
    const hook = webhookByType.get(c.type);
    if (hook) await notifyWebhook(hook, { type: c.type, severity: c.severity, title: c.title, clientId, workspaceId, at: now.toISOString() });
  }
  // Auto-resolución: abiertas cuya condición ya no se cumple.
  for (const e of existing) {
    if (!candidateKeys.has(e.dedupKey)) {
      await prisma.gmbAlert.updateMany({ where: { id: e.id, workspaceId }, data: { status: "resolved", resolvedAt: now } });
      resolved++;
    }
  }
  return { created, resolved };
}

export async function generateAlertsForWorkspace(prisma: PrismaLike, workspaceId: string, now: Date = new Date()): Promise<{ clients: number; created: number; resolved: number }> {
  const clients = await prisma.gmbClient.findMany({ where: { workspaceId }, select: { id: true }, take: 500 });
  let created = 0, resolved = 0;
  for (const c of clients) {
    const r = await generateAlertsForClient(prisma, workspaceId, c.id, now);
    created += r.created; resolved += r.resolved;
  }
  return { clients: clients.length, created, resolved };
}

/** Worker de cron: genera alertas para todos los workspaces con fichas. Bounded. */
export async function processAllGmbAlerts(prisma: PrismaLike, opts: { maxWorkspaces?: number } = {}): Promise<{ workspaces: number; created: number }> {
  const groups = await prisma.gmbClient.groupBy({ by: ["workspaceId"], _count: { _all: true }, take: opts.maxWorkspaces ?? 100 }).catch(() => []);
  let created = 0, count = 0;
  const now = new Date();
  for (const g of groups) {
    try { const r = await generateAlertsForWorkspace(prisma, g.workspaceId, now); created += r.created; count++; } catch (e: any) { console.warn(`[gmb-alerts] ws=${g.workspaceId} FALLO: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  return { workspaces: count, created };
}
