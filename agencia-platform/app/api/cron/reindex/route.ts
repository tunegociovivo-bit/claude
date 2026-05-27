/**
 * GET /api/cron/reindex
 *
 * Recorre todos los workspaces y indexa lo nuevo o modificado.
 * Pensado para correr una vez al día como red de seguridad: los
 * hooks en los endpoints ya re-indexan en tiempo real, pero si un
 * envío a OpenAI falla (rate limit, key inválida temporalmente),
 * este cron lo recoge en el siguiente pase.
 *
 * Seguridad: Bearer CRON_SECRET o ?secret=
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { indexEntity } from "@/lib/search/embeddings";
import {
  textForClient,
  textForComment,
  textForDocument,
  textForProject,
  textForTask
} from "@/lib/search/indexers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

// Cap por ejecución para no quemar tokens en un solo turno.
const PER_WORKSPACE_LIMIT = 50;

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const summary: Record<string, any> = {};

  for (const ws of workspaces) {
    const indexedSet = new Set(
      (
        await prisma.searchEmbedding.findMany({
          where: { workspaceId: ws.id },
          select: { entityType: true, entityId: true }
        })
      ).map((r) => `${r.entityType}:${r.entityId}`)
    );
    summary[ws.id] = { tasks: 0, clients: 0, projects: 0, documents: 0 };

    const tasks = await prisma.task.findMany({
      where: { workspaceId: ws.id, deletedAt: null } as any,
      select: { id: true, title: true, description: true },
      take: PER_WORKSPACE_LIMIT
    });
    for (const t of tasks) {
      if (indexedSet.has(`TASK:${t.id}`)) continue;
      const r = await indexEntity({
        workspaceId: ws.id,
        entityType: "TASK",
        entityId: t.id,
        text: textForTask(t as any)
      });
      if (r.updated) summary[ws.id].tasks++;
    }

    const clients = await prisma.client.findMany({
      where: { workspaceId: ws.id, deletedAt: null },
      take: PER_WORKSPACE_LIMIT
    });
    for (const c of clients) {
      if (indexedSet.has(`CLIENT:${c.id}`)) continue;
      const r = await indexEntity({
        workspaceId: ws.id,
        entityType: "CLIENT",
        entityId: c.id,
        text: textForClient(c as any)
      });
      if (r.updated) summary[ws.id].clients++;
    }

    const projects = await prisma.project.findMany({
      where: { workspaceId: ws.id, deletedAt: null } as any,
      select: { id: true, name: true, description: true },
      take: PER_WORKSPACE_LIMIT
    });
    for (const p of projects) {
      if (indexedSet.has(`PROJECT:${p.id}`)) continue;
      const r = await indexEntity({
        workspaceId: ws.id,
        entityType: "PROJECT",
        entityId: p.id,
        text: textForProject(p as any)
      });
      if (r.updated) summary[ws.id].projects++;
    }

    const docs = await prisma.document.findMany({
      where: { workspaceId: ws.id, archived: false, deletedAt: null } as any,
      select: { id: true, title: true, content: true },
      take: PER_WORKSPACE_LIMIT
    });
    for (const d of docs) {
      if (indexedSet.has(`DOCUMENT:${d.id}`)) continue;
      const r = await indexEntity({
        workspaceId: ws.id,
        entityType: "DOCUMENT",
        entityId: d.id,
        text: textForDocument(d as any)
      });
      if (r.updated) summary[ws.id].documents++;
    }

    summary[ws.id].comments = 0;
    const comments = await prisma.comment.findMany({
      where: { workspaceId: ws.id },
      select: { id: true, body: true, bodyJson: true },
      orderBy: { createdAt: "desc" },
      take: PER_WORKSPACE_LIMIT
    });
    for (const c of comments) {
      if (indexedSet.has(`COMMENT:${c.id}`)) continue;
      const r = await indexEntity({
        workspaceId: ws.id,
        entityType: "COMMENT",
        entityId: c.id,
        text: textForComment({ body: c.bodyJson ?? c.body })
      });
      if (r.updated) summary[ws.id].comments++;
    }
  }

  return NextResponse.json({ ok: true, workspaces: Object.keys(summary).length, summary });
}
