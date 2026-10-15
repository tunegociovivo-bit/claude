import "server-only";
import { prisma } from "@/lib/prisma";
import { parseCriteria, criteriaErrors, describeCriteria, type RadarCriteria } from "./criteria";

export type SearchView = {
  id: string;
  name: string;
  active: boolean;
  criteria: RadarCriteria;
  summary: string;
  notifyWhatsapp: boolean;
  notifyEmail: boolean;
  matchCount: number;
  createdAt: string;
};

export const MAX_SEARCHES = 30;

export async function listSearches(workspaceId: string): Promise<SearchView[]> {
  const rows = await prisma.radarSearch.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { matches: true } } },
  });
  return rows.map((r) => {
    const criteria = parseCriteria(r.criteria);
    return {
      id: r.id,
      name: r.name,
      active: r.active,
      criteria,
      summary: describeCriteria(criteria),
      notifyWhatsapp: r.notifyWhatsapp,
      notifyEmail: r.notifyEmail,
      matchCount: r._count.matches,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function createSearch(opts: {
  workspaceId: string;
  name: string;
  criteria: unknown;
  notifyWhatsapp?: boolean;
  notifyEmail?: boolean;
  active?: boolean;
}): Promise<string> {
  const name = opts.name.trim().slice(0, 80);
  if (!name) throw new Error("Pon un nombre a la búsqueda (p. ej. «Furgonetas diésel baratas»).");
  const count = await prisma.radarSearch.count({ where: { workspaceId: opts.workspaceId } });
  if (count >= MAX_SEARCHES) throw new Error(`Has llegado al máximo de ${MAX_SEARCHES} búsquedas.`);
  const criteria = parseCriteria(opts.criteria);
  const errors = criteriaErrors(criteria);
  if (errors.length) throw new Error(errors.join(" "));
  const row = await prisma.radarSearch.create({
    data: {
      workspaceId: opts.workspaceId,
      name,
      criteria: criteria as any,
      active: opts.active ?? true,
      notifyWhatsapp: opts.notifyWhatsapp ?? true,
      notifyEmail: opts.notifyEmail ?? true,
    },
  });
  return row.id;
}

export async function updateSearch(opts: {
  workspaceId: string;
  id: string;
  name?: string;
  criteria?: unknown;
  notifyWhatsapp?: boolean;
  notifyEmail?: boolean;
  active?: boolean;
}): Promise<void> {
  const existing = await prisma.radarSearch.findFirst({ where: { id: opts.id, workspaceId: opts.workspaceId }, select: { id: true } });
  if (!existing) throw new Error("Búsqueda no encontrada");
  const data: any = {};
  if (opts.name !== undefined) {
    const name = opts.name.trim().slice(0, 80);
    if (!name) throw new Error("La búsqueda necesita un nombre.");
    data.name = name;
  }
  if (opts.criteria !== undefined) {
    const criteria = parseCriteria(opts.criteria);
    const errors = criteriaErrors(criteria);
    if (errors.length) throw new Error(errors.join(" "));
    data.criteria = criteria as any;
  }
  if (opts.notifyWhatsapp !== undefined) data.notifyWhatsapp = opts.notifyWhatsapp;
  if (opts.notifyEmail !== undefined) data.notifyEmail = opts.notifyEmail;
  if (opts.active !== undefined) data.active = opts.active;
  await prisma.radarSearch.update({ where: { id: opts.id }, data });
}

export async function deleteSearch(workspaceId: string, id: string): Promise<void> {
  await prisma.radarSearch.deleteMany({ where: { id, workspaceId } });
}
