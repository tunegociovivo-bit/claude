/**
 * Diagnóstico de publicaciones huérfanas: posts sin fecha programada,
 * sin cliente, o sin networks (problemas típicos tras import).
 *
 * GET → lista
 * POST → repara según action: "delete" | "to_draft" | "set_default_date"
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const all = await prisma.editorialPost.findMany({
    where: { workspaceId: api.workspaceId },
    select: {
      id: true,
      title: true,
      status: true,
      scheduledFor: true,
      clientId: true,
      networks: true,
      content: true,
      thumbnail: true,
      mediaUrls: true,
      createdAt: true,
      client: { select: { id: true, name: true } }
    }
  });

  type Orphan = {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    client: { id: string; name: string } | null;
    issues: string[];
  };
  const orphans: Orphan[] = [];
  for (const p of all) {
    const issues: string[] = [];
    if (!p.scheduledFor) issues.push("sin_fecha");
    if (!p.clientId) issues.push("sin_cliente");
    if (!p.content || p.content.trim().length === 0) issues.push("sin_copy");
    try {
      const nets = JSON.parse(p.networks);
      if (!Array.isArray(nets) || nets.length === 0) issues.push("sin_red");
    } catch {
      issues.push("sin_red");
    }
    let mediaUrls: string[] = [];
    try {
      const mu = JSON.parse(p.mediaUrls);
      if (Array.isArray(mu)) mediaUrls = mu;
    } catch {}
    if (!p.thumbnail && mediaUrls.length === 0) issues.push("sin_imagen");

    if (issues.length > 0) {
      orphans.push({
        id: p.id,
        title: p.title,
        status: p.status,
        createdAt: p.createdAt,
        client: p.client,
        issues
      });
    }
  }
  return NextResponse.json({ orphans, total: orphans.length });
});

const repairSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["delete", "to_draft", "set_default_date"]),
  defaultDate: z.string().datetime().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = repairSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const where = { id: { in: parsed.data.ids }, workspaceId: api.workspaceId };

  let affected = 0;
  if (parsed.data.action === "delete") {
    const r = await prisma.editorialPost.deleteMany({ where });
    affected = r.count;
  } else if (parsed.data.action === "to_draft") {
    const r = await prisma.editorialPost.updateMany({ where, data: { status: "DRAFT" } });
    affected = r.count;
  } else if (parsed.data.action === "set_default_date") {
    const d = parsed.data.defaultDate ? new Date(parsed.data.defaultDate) : new Date();
    const r = await prisma.editorialPost.updateMany({ where, data: { scheduledFor: d } });
    affected = r.count;
  }
  return NextResponse.json({ ok: true, affected });
});
