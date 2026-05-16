/**
 * POST /api/v1/admin/reindex
 *
 * Backfill de embeddings: recorre todas las tareas, clientes,
 * proyectos y documentos del workspace que no tengan embedding (o
 * cuyo texto haya cambiado) y los indexa. Útil tras importar datos
 * legacy o cambiar el modelo de embedding.
 *
 * Body: { entityTypes?: ("TASK"|"CLIENT"|"PROJECT"|"DOCUMENT")[], limit?: number }
 *
 * Sólo admin. Devuelve un resumen con cuántos se indexaron por tipo.
 * El proceso es síncrono para batches pequeños; para workspaces
 * gigantes conviene partir en varios POST con `limit` chico.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { indexEntity, type EntityType } from "@/lib/search/embeddings";
import {
  textForClient,
  textForDocument,
  textForProject,
  textForTask
} from "@/lib/search/indexers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  entityTypes: z.array(z.enum(["TASK", "CLIENT", "PROJECT", "DOCUMENT"])).optional(),
  limit: z.number().int().min(1).max(500).optional()
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const limit = parsed.data.limit ?? 100;
  const types = (parsed.data.entityTypes ?? ["TASK", "CLIENT", "PROJECT", "DOCUMENT"]) as EntityType[];

  const counts: Record<string, { indexed: number; skipped: number }> = {};

  if (types.includes("TASK")) {
    counts.TASK = { indexed: 0, skipped: 0 };
    const rows = await prisma.task.findMany({
      where: { workspaceId: api.workspaceId, deletedAt: null } as any,
      select: { id: true, title: true, description: true },
      take: limit
    });
    for (const t of rows) {
      const r = await indexEntity({
        workspaceId: api.workspaceId,
        entityType: "TASK",
        entityId: t.id,
        text: textForTask(t as any)
      });
      r.updated ? counts.TASK.indexed++ : counts.TASK.skipped++;
    }
  }

  if (types.includes("CLIENT")) {
    counts.CLIENT = { indexed: 0, skipped: 0 };
    const rows = await prisma.client.findMany({
      where: { workspaceId: api.workspaceId, deletedAt: null },
      take: limit
    });
    for (const c of rows) {
      const r = await indexEntity({
        workspaceId: api.workspaceId,
        entityType: "CLIENT",
        entityId: c.id,
        text: textForClient(c as any)
      });
      r.updated ? counts.CLIENT.indexed++ : counts.CLIENT.skipped++;
    }
  }

  if (types.includes("PROJECT")) {
    counts.PROJECT = { indexed: 0, skipped: 0 };
    const rows = await prisma.project.findMany({
      where: { workspaceId: api.workspaceId, deletedAt: null } as any,
      select: { id: true, name: true, description: true },
      take: limit
    });
    for (const p of rows) {
      const r = await indexEntity({
        workspaceId: api.workspaceId,
        entityType: "PROJECT",
        entityId: p.id,
        text: textForProject(p as any)
      });
      r.updated ? counts.PROJECT.indexed++ : counts.PROJECT.skipped++;
    }
  }

  if (types.includes("DOCUMENT")) {
    counts.DOCUMENT = { indexed: 0, skipped: 0 };
    const rows = await prisma.document.findMany({
      where: { workspaceId: api.workspaceId, archived: false, deletedAt: null } as any,
      select: { id: true, title: true, content: true },
      take: limit
    });
    for (const d of rows) {
      const r = await indexEntity({
        workspaceId: api.workspaceId,
        entityType: "DOCUMENT",
        entityId: d.id,
        text: textForDocument(d as any)
      });
      r.updated ? counts.DOCUMENT.indexed++ : counts.DOCUMENT.skipped++;
    }
  }

  return NextResponse.json({ ok: true, counts, limit });
});
