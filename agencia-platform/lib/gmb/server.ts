/**
 * Helpers de servidor del GMB Hub (tenant-scoped). Ensamblan datos REALES de la ficha para el
 * Local Presence Score, resuelven el NAP canónico y generan oportunidades por reglas. Nunca
 * inventan datos: lo que no existe puntúa 0 / queda "sin conectar".
 */
import type { PresenceInput } from "./presence-score";
import type { Nap } from "./nap";
import { computeActionPriority } from "./actions";

type PrismaLike = any;

/** Carga la ficha del workspace o lanza 404 (patrón estándar del hub). */
export async function ensureGmbClient(prisma: PrismaLike, workspaceId: string, id: string) {
  const client = await prisma.gmbClient.findFirst({ where: { id, workspaceId } });
  if (!client) return null;
  return client;
}

/** NAP canónico ACTIVO de la ficha; si no hay versión, deriva de los campos de la ficha. */
export async function getCanonicalNap(prisma: PrismaLike, workspaceId: string, client: any): Promise<Nap & { version: number; fromClient: boolean }> {
  const active = await prisma.gmbNapProfile.findFirst({ where: { workspaceId, clientId: client.id, active: true }, orderBy: { version: "desc" } });
  if (active) return { name: active.name, address: active.address, phone: active.phone, website: active.website, version: active.version, fromClient: false };
  return { name: client.name ?? "", address: client.address ?? "", phone: client.phone ?? "", website: client.website ?? "", version: 0, fromClient: true };
}

/** Estadísticas de citaciones de la ficha (para score y oportunidades). */
export async function citationStats(prisma: PrismaLike, workspaceId: string, clientId: string): Promise<{ total: number; published: number; consistent: number; inconsistent: number; notFound: number }> {
  const rows = await prisma.gmbCitation.findMany({ where: { workspaceId, clientId }, select: { status: true } });
  const total = rows.length;
  const published = rows.filter((r: any) => r.status === "published").length;
  const inconsistent = rows.filter((r: any) => r.status === "inconsistent").length;
  const notFound = rows.filter((r: any) => r.status === "not_found").length;
  return { total, published, consistent: published, inconsistent, notFound };
}

/** Ensambla el PresenceInput de una ficha con datos reales del workspace. */
export async function gatherPresenceInput(prisma: PrismaLike, workspaceId: string, client: any): Promise<PresenceInput> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [reviewAgg, repliedCount, postsLast30, photoCount, cites, positions] = await Promise.all([
    prisma.gmbReview.aggregate({ where: { workspaceId, clientId: client.id }, _count: { _all: true }, _avg: { rating: true } }),
    prisma.gmbReview.count({ where: { workspaceId, clientId: client.id, reviewReply: { not: null } } }),
    prisma.gmbPost.count({ where: { workspaceId, clientId: client.id, status: "published", publishedAt: { gte: since } } }),
    prisma.gmbPhoto.count({ where: { workspaceId, clientId: client.id } }),
    citationStats(prisma, workspaceId, client.id),
    prisma.gmbPosition.findMany({ where: { workspaceId, clientId: client.id }, select: { keyword: true, top3Count: true, cellCount: true } })
  ]);
  const reviewCount = reviewAgg._count?._all ?? 0;
  const avgRating = reviewAgg._avg?.rating ?? 0;
  const responseRate = reviewCount > 0 ? repliedCount / reviewCount : 0;
  const byKeyword = new Map<string, { top3: number; cells: number }>();
  for (const p of positions) {
    const cur = byKeyword.get(p.keyword) ?? { top3: 0, cells: 0 };
    byKeyword.set(p.keyword, { top3: Math.max(cur.top3, p.top3Count ?? 0), cells: Math.max(cur.cells, p.cellCount ?? 0) });
  }
  const shares = [...byKeyword.values()].map((v) => (v.cells > 0 ? v.top3 / v.cells : 0));
  const avgTop3Share = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0;

  return {
    profile: {
      hasDescription: !!(client.description && String(client.description).trim()),
      hasCategory: !!(client.category && String(client.category).trim()),
      hasPhone: !!(client.phone && String(client.phone).trim()),
      hasWebsite: !!(client.website && String(client.website).trim()),
      hasAddress: !!(client.address && String(client.address).trim()),
      hasHours: !!(client.placeId && String(client.placeId).trim()), // proxy: ficha conectada a un Place real
      photoCount
    },
    reviews: { count: reviewCount, avgRating, responseRate },
    content: { postsLast30, photoCount },
    citations: { total: cites.total, published: cites.published, consistent: cites.consistent },
    ranking: { keywordsTracked: byKeyword.size, avgTop3Share },
    web: { hasWebsite: !!(client.website && String(client.website).trim()), hasSchema: false }
  };
}

export type RuleOpportunity = { module: string; type: string; title: string; description: string; impact: number; effort: number; confidence: number; external: boolean; requiresApproval: boolean; priority: number; evidence: any };

/**
 * Oportunidades por REGLAS deterministas a partir del score y las citaciones. Base honesta del
 * piloto automático (el AI Council añade/afina, no sustituye). Marca external/requiresApproval.
 */
export function buildRuleOpportunities(input: PresenceInput, breakdown: { profile: number; reviews: number; content: number; citations: number; ranking: number; web: number }, cites: { total: number; notFound: number; inconsistent: number }): RuleOpportunity[] {
  const out: RuleOpportunity[] = [];
  const add = (o: Omit<RuleOpportunity, "priority">) => out.push({ ...o, priority: computeActionPriority(o) });

  if (!input.profile.hasDescription) add({ module: "presence", type: "add_description", title: "Añadir descripción del negocio", description: "La ficha no tiene descripción. Redacta una con la keyword principal y la propuesta de valor.", impact: 60, effort: 20, confidence: 90, external: false, requiresApproval: false, evidence: { breakdown: breakdown.profile } });
  if (input.profile.photoCount < 5) add({ module: "content", type: "add_photos", title: "Subir más fotos", description: `Solo hay ${input.profile.photoCount} fotos. Las fichas con 10+ fotos reciben más clics.`, impact: 55, effort: 25, confidence: 85, external: false, requiresApproval: false, evidence: { photoCount: input.profile.photoCount } });
  if (input.content.postsLast30 < 4) add({ module: "content", type: "schedule_posts", title: "Programar publicaciones semanales", description: `Solo ${input.content.postsLast30} posts en 30 días. Programa 1 novedad/semana.`, impact: 50, effort: 30, confidence: 80, external: true, requiresApproval: true, evidence: { postsLast30: input.content.postsLast30 } });
  if (input.reviews.responseRate < 0.8 && input.reviews.count > 0) add({ module: "reviews", type: "reply_reviews", title: "Responder reseñas pendientes", description: `Tasa de respuesta ${(input.reviews.responseRate * 100).toFixed(0)}%. Responder todas mejora ranking y confianza.`, impact: 65, effort: 20, confidence: 90, external: true, requiresApproval: true, evidence: { responseRate: input.reviews.responseRate } });
  if (cites.total === 0) add({ module: "citations", type: "seed_citations", title: "Crear inventario de citaciones", description: "Aún no hay citaciones catalogadas. Genera el inventario de directorios recomendados.", impact: 55, effort: 15, confidence: 85, external: false, requiresApproval: false, evidence: {} });
  if (cites.notFound > 0) add({ module: "citations", type: "submit_citations", title: `Dar de alta en ${cites.notFound} directorio(s)`, description: "Hay directorios donde el negocio no aparece. Prepara los paquetes de alta.", impact: 60, effort: 40, confidence: 75, external: true, requiresApproval: true, evidence: { notFound: cites.notFound } });
  if (cites.inconsistent > 0) add({ module: "citations", type: "fix_inconsistencies", title: `Corregir ${cites.inconsistent} NAP inconsistente(s)`, description: "Hay citaciones con datos que no cuadran con el NAP canónico. Corrígelas para no penalizar el SEO local.", impact: 70, effort: 35, confidence: 85, external: true, requiresApproval: true, evidence: { inconsistent: cites.inconsistent } });
  if (input.ranking.keywordsTracked === 0) add({ module: "rank", type: "track_keywords", title: "Configurar seguimiento de keywords", description: "No hay keywords rastreadas. Añade las principales para medir el rank grid.", impact: 45, effort: 20, confidence: 80, external: false, requiresApproval: false, evidence: {} });

  return out.sort((a, b) => b.priority - a.priority);
}
