/**
 * Acciones en masa sobre todas las publicaciones de un mes/cliente:
 *   - approve: cambia DRAFT/REVIEW → APPROVED
 *   - schedule: cambia APPROVED → SCHEDULED
 *   - publish: marca SCHEDULED → PUBLISHED + sella publishedAt = now
 *   - duplicate: copia las del mes origen al mes destino con status DRAFT
 *   - archive: cualquier → ARCHIVED
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const baseSchema = z.object({
  action: z.enum(["approve", "schedule", "publish", "duplicate", "archive"]),
  clientId: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/).optional() // solo para duplicate
});

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1))
  };
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = baseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { action, clientId, month, targetMonth } = parsed.data;

  const { start, end } = monthRange(month);
  const where: any = {
    workspaceId: api.workspaceId,
    scheduledFor: { gte: start, lt: end }
  };
  if (clientId) where.clientId = clientId;

  if (action === "approve") {
    const r = await prisma.editorialPost.updateMany({
      where: { ...where, status: { in: ["DRAFT", "REVIEW"] } },
      data: { status: "APPROVED" }
    });
    return NextResponse.json({ ok: true, affected: r.count });
  }
  if (action === "schedule") {
    const r = await prisma.editorialPost.updateMany({
      where: { ...where, status: "APPROVED" },
      data: { status: "SCHEDULED" }
    });
    return NextResponse.json({ ok: true, affected: r.count });
  }
  if (action === "publish") {
    const r = await prisma.editorialPost.updateMany({
      where: { ...where, status: { in: ["SCHEDULED", "APPROVED"] } },
      data: { status: "PUBLISHED", publishedAt: new Date() }
    });
    return NextResponse.json({ ok: true, affected: r.count });
  }
  if (action === "archive") {
    const r = await prisma.editorialPost.updateMany({ where, data: { status: "ARCHIVED" } });
    return NextResponse.json({ ok: true, affected: r.count });
  }
  if (action === "duplicate") {
    if (!targetMonth) throw new ApiError(400, "missing_target", "Falta targetMonth para duplicate");
    if (targetMonth === month) throw new ApiError(400, "same_month", "El mes destino no puede ser el mismo");
    const source = await prisma.editorialPost.findMany({ where });
    const [ty, tm] = targetMonth.split("-").map(Number);
    let created = 0;
    for (const p of source) {
      if (!p.scheduledFor) continue;
      const origDay = p.scheduledFor.getUTCDate();
      const daysInTarget = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      const newDay = Math.min(origDay, daysInTarget);
      const newDate = new Date(Date.UTC(ty, tm - 1, newDay, p.scheduledFor.getUTCHours(), p.scheduledFor.getUTCMinutes()));
      await prisma.editorialPost.create({
        data: {
          workspaceId: p.workspaceId,
          clientId: p.clientId,
          title: p.title,
          content: p.content,
          excerpt: p.excerpt,
          status: "DRAFT",
          format: p.format,
          networks: p.networks,
          mediaUrls: p.mediaUrls,
          thumbnail: p.thumbnail,
          metaJson: p.metaJson ?? undefined,
          scheduledFor: newDate
        }
      });
      created++;
    }
    return NextResponse.json({ ok: true, created });
  }
  throw new ApiError(400, "unknown_action", action);
});
