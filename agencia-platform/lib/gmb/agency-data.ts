/**
 * Agregación de señales de agencia (portfolio + alertas), TENANT-SCOPED y por lotes (sin N+1).
 * Reutiliza datos reales; lo que no existe queda en 0/null (nunca inventado).
 */
import type { PortfolioRow } from "./portfolio";
import type { AlertSignals } from "./alerts";

type PrismaLike = any;
const DAY = 24 * 3600 * 1000;

/** Conexión de workspace (Maps/Make) — igual para todas las fichas del tenant. */
async function workspaceConnectionOk(prisma: PrismaLike, workspaceId: string): Promise<boolean> {
  try {
    const { getGmbMapsKey, getGmbConfig } = await import("@/lib/integrations/gmb-hub");
    const [maps, cfg] = await Promise.all([getGmbMapsKey(workspaceId).catch(() => null), getGmbConfig(workspaceId).catch(() => null)]);
    return !!maps || !!(cfg && (cfg.replyWebhookUrl || cfg.ingestToken));
  } catch {
    return false;
  }
}

/** Cuenta keywords con caída de posición (última medición peor que la anterior) por ficha. */
function rankingDropByClient(positions: any[]): Map<string, number> {
  const byClientKw = new Map<string, any[]>();
  for (const p of positions) {
    const k = `${p.clientId}:${p.keyword}`;
    const arr = byClientKw.get(k) ?? [];
    if (arr.length < 2) { arr.push(p); byClientKw.set(k, arr); }
  }
  const out = new Map<string, number>();
  for (const [k, arr] of byClientKw) {
    if (arr.length < 2) continue;
    const [last, prev] = arr;
    if (typeof last.avgPosition === "number" && typeof prev.avgPosition === "number" && last.avgPosition > prev.avgPosition) {
      const clientId = k.split(":")[0];
      out.set(clientId, (out.get(clientId) ?? 0) + 1);
    }
  }
  return out;
}

/** Filas del portfolio para todas las fichas del workspace. */
export async function portfolioRows(prisma: PrismaLike, workspaceId: string, now: Date = new Date()): Promise<PortfolioRow[]> {
  const clients = await prisma.gmbClient.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, category: true } });
  if (clients.length === 0) return [];
  const ids = clients.map((c: any) => c.id);

  const [unreplied, negUnreplied, broken, scores, posts, positions, alertsOpen, alertsCrit] = await Promise.all([
    prisma.gmbReview.groupBy({ by: ["clientId"], where: { workspaceId, clientId: { in: ids }, reviewReply: null }, _count: { _all: true } }).catch(() => []),
    prisma.gmbReview.groupBy({ by: ["clientId"], where: { workspaceId, clientId: { in: ids }, reviewReply: null, rating: { lte: 2 } }, _count: { _all: true } }).catch(() => []),
    prisma.gmbCitation.groupBy({ by: ["clientId"], where: { workspaceId, clientId: { in: ids }, status: { in: ["inconsistent", "error"] } }, _count: { _all: true } }).catch(() => []),
    prisma.gmbPresenceScore.findMany({ where: { workspaceId, clientId: { in: ids } }, orderBy: { recordedAt: "desc" }, take: 1000, select: { clientId: true, total: true, recordedAt: true } }).catch(() => []),
    prisma.gmbPost.findMany({ where: { workspaceId, clientId: { in: ids }, status: "published" }, orderBy: { publishedAt: "desc" }, take: 1000, select: { clientId: true, publishedAt: true } }).catch(() => []),
    prisma.gmbPosition.findMany({ where: { workspaceId, clientId: { in: ids } }, orderBy: { checkedAt: "desc" }, take: 2000, select: { clientId: true, keyword: true, avgPosition: true, checkedAt: true } }).catch(() => []),
    prisma.gmbAlert.groupBy({ by: ["clientId"], where: { workspaceId, clientId: { in: ids }, status: { in: ["open", "ack"] } }, _count: { _all: true } }).catch(() => []),
    prisma.gmbAlert.groupBy({ by: ["clientId"], where: { workspaceId, clientId: { in: ids }, status: { in: ["open", "ack"] }, severity: "critical" }, _count: { _all: true } }).catch(() => [])
  ]);

  const cnt = (g: any[]) => new Map(g.map((r: any) => [r.clientId, r._count?._all ?? 0]));
  const mUnreplied = cnt(unreplied), mBroken = cnt(broken), mAlerts = cnt(alertsOpen), mCrit = cnt(alertsCrit);
  const scoreByClient = new Map<string, number>();
  for (const s of scores) if (!scoreByClient.has(s.clientId)) scoreByClient.set(s.clientId, s.total);
  const lastPostByClient = new Map<string, Date>();
  for (const p of posts) if (p.publishedAt && !lastPostByClient.has(p.clientId)) lastPostByClient.set(p.clientId, new Date(p.publishedAt));
  const mDrop = rankingDropByClient(positions);
  const connectionOk = await workspaceConnectionOk(prisma, workspaceId);

  return clients.map((c: any) => {
    const lastPost = lastPostByClient.get(c.id);
    return {
      clientId: c.id, name: c.name, category: c.category ?? "",
      score: scoreByClient.has(c.id) ? scoreByClient.get(c.id)! : null,
      unreplied: mUnreplied.get(c.id) ?? 0,
      brokenCitations: mBroken.get(c.id) ?? 0,
      rankingDrop: mDrop.get(c.id) ?? 0,
      contentStaleDays: lastPost ? Math.floor((now.getTime() - lastPost.getTime()) / DAY) : null,
      connectionOk,
      openAlerts: mAlerts.get(c.id) ?? 0,
      criticalAlerts: mCrit.get(c.id) ?? 0
    };
  });
}

/** Señales de una ficha concreta (para el motor de alertas). */
export async function clientSignals(prisma: PrismaLike, workspaceId: string, clientId: string, now: Date = new Date()): Promise<AlertSignals> {
  const [unreplied, negUnreplied, broken, posts, positions, conn] = await Promise.all([
    prisma.gmbReview.count({ where: { workspaceId, clientId, reviewReply: null } }),
    prisma.gmbReview.count({ where: { workspaceId, clientId, reviewReply: null, rating: { lte: 2 } } }),
    prisma.gmbCitation.count({ where: { workspaceId, clientId, status: { in: ["inconsistent", "error"] } } }),
    prisma.gmbPost.findFirst({ where: { workspaceId, clientId, status: "published" }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true } }),
    prisma.gmbPosition.findMany({ where: { workspaceId, clientId }, orderBy: { checkedAt: "desc" }, take: 200, select: { clientId: true, keyword: true, avgPosition: true, checkedAt: true } }),
    workspaceConnectionOk(prisma, workspaceId)
  ]);
  const daysSinceLastPost = posts?.publishedAt ? Math.floor((now.getTime() - new Date(posts.publishedAt).getTime()) / DAY) : null;
  return {
    unrepliedReviews: unreplied,
    negativeUnreplied: negUnreplied,
    brokenCitations: broken,
    rankingDropKeywords: rankingDropByClient(positions).get(clientId) ?? 0,
    daysSinceLastPost,
    connectionDown: !conn
  };
}
