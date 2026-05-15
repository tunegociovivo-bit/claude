/**
 * POST /api/v1/editorial/duplicate-month
 * Body: { clientId, sourceMonth: "YYYY-MM", targetMonth: "YYYY-MM",
 *         resetStatus?: boolean (default true) }
 *
 * Copia todas las publicaciones del cliente en sourceMonth a targetMonth,
 * desplazando las fechas. Por defecto las nuevas se crean en estado DRAFT.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({
  clientId: z.string().min(1),
  sourceMonth: z.string().regex(/^\d{4}-\d{2}$/),
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/),
  resetStatus: z.boolean().default(true)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { clientId, sourceMonth, targetMonth, resetStatus } = parsed.data;
  if (sourceMonth === targetMonth) {
    throw new ApiError(400, "same_month", "Origen y destino son el mismo mes");
  }

  const [sy, sm] = sourceMonth.split("-").map(Number);
  const [ty, tm] = targetMonth.split("-").map(Number);
  const srcStart = new Date(Date.UTC(sy, sm - 1, 1));
  const srcEnd = new Date(Date.UTC(sy, sm, 1));
  const targetDays = new Date(Date.UTC(ty, tm, 0)).getUTCDate();

  const source = await prisma.editorialPost.findMany({
    where: {
      workspaceId: api.workspaceId,
      clientId,
      scheduledFor: { gte: srcStart, lt: srcEnd }
    }
  });
  if (source.length === 0) {
    return NextResponse.json({ created: 0, message: "No hay publicaciones en el mes origen" });
  }

  const created: string[] = [];
  for (const p of source) {
    if (!p.scheduledFor) continue;
    const day = Math.min(targetDays, p.scheduledFor.getUTCDate());
    const newDate = new Date(
      Date.UTC(ty, tm - 1, day, p.scheduledFor.getUTCHours(), p.scheduledFor.getUTCMinutes(), 0)
    );

    const c = await prisma.editorialPost.create({
      data: {
        workspaceId: api.workspaceId,
        clientId,
        title: p.title,
        content: p.content,
        excerpt: p.excerpt,
        hashtags: p.hashtags,
        firstComment: p.firstComment,
        copyByNetwork: p.copyByNetwork as any,
        format: p.format,
        networks: p.networks,
        thumbnail: p.thumbnail,
        mediaUrls: p.mediaUrls,
        status: resetStatus ? "DRAFT" : p.status,
        scheduledFor: newDate
      }
    });
    created.push(c.id);
  }

  return NextResponse.json({ created: created.length, ids: created });
});
