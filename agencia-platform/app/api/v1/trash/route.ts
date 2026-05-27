/**
 * GET /api/v1/trash
 *
 * Lista todo lo que está en papelera (deletedAt != null) en el
 * workspace, ordenado por más reciente. Mezcla tasks, projects,
 * documents y clients. Sólo accesible para ADMIN.
 *
 * El registro permanece RETENTION_DAYS días; tras eso, el cron
 * /api/cron/trash-purge lo borra de forma definitiva.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { RETENTION_DAYS, type TrashItem } from "@/lib/trash";

export const GET = withApi({ scope: "tasks:read" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) {
    throw new ApiError(403, "forbidden", "Solo admin puede ver la papelera");
  }
  const w = { workspaceId: api.workspaceId, deletedAt: { not: null } } as any;

  const [tasks, projects, documents, clients] = await Promise.all([
    prisma.task.findMany({
      where: w,
      orderBy: { deletedAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        deletedAt: true,
        deletedById: true,
        project: { select: { name: true } },
        client: { select: { name: true } }
      } as any
    }),
    prisma.project.findMany({
      where: w,
      orderBy: { deletedAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        deletedAt: true,
        deletedById: true,
        client: { select: { name: true } }
      } as any
    }),
    prisma.document.findMany({
      where: w,
      orderBy: { deletedAt: "desc" },
      take: 100,
      select: { id: true, title: true, deletedAt: true, deletedById: true } as any
    }),
    prisma.client.findMany({
      where: w,
      orderBy: { deletedAt: "desc" },
      take: 100,
      select: { id: true, name: true, deletedAt: true, deletedById: true }
    })
  ]);

  const actorIds = Array.from(
    new Set(
      [...tasks, ...projects, ...documents, ...clients]
        .map((x: any) => x.deletedById)
        .filter((x): x is string => !!x)
    )
  );
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true, email: true }
  });
  const nameOf = new Map(actors.map((a) => [a.id, a.name ?? a.email]));

  const items: TrashItem[] = [
    ...tasks.map((t: any) => ({
      id: t.id,
      model: "task" as const,
      title: t.title,
      deletedAt: t.deletedAt.toISOString(),
      deletedById: t.deletedById ?? null,
      deletedByName: t.deletedById ? nameOf.get(t.deletedById) ?? null : null,
      context: [t.project?.name, t.client?.name].filter(Boolean).join(" · ") || null
    })),
    ...projects.map((p: any) => ({
      id: p.id,
      model: "project" as const,
      title: p.name,
      deletedAt: p.deletedAt.toISOString(),
      deletedById: p.deletedById ?? null,
      deletedByName: p.deletedById ? nameOf.get(p.deletedById) ?? null : null,
      context: p.client?.name ?? null
    })),
    ...documents.map((d: any) => ({
      id: d.id,
      model: "document" as const,
      title: d.title,
      deletedAt: d.deletedAt.toISOString(),
      deletedById: d.deletedById ?? null,
      deletedByName: d.deletedById ? nameOf.get(d.deletedById) ?? null : null,
      context: null
    })),
    ...clients.map((c: any) => ({
      id: c.id,
      model: "client" as const,
      title: c.name,
      deletedAt: c.deletedAt.toISOString(),
      deletedById: c.deletedById ?? null,
      deletedByName: c.deletedById ? nameOf.get(c.deletedById) ?? null : null,
      context: null
    }))
  ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  return NextResponse.json({ items, retentionDays: RETENTION_DAYS });
});
