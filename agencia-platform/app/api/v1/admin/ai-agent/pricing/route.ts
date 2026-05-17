/**
 * GET  /api/v1/admin/ai-agent/pricing → lista servicios
 * POST /api/v1/admin/ai-agent/pricing → crea servicio
 *      body: { name, baseAmountEur, minAmountEur, unit?, description?, tradeoffs[]? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const items = await prisma.pricingService.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: [{ active: "desc" }, { name: "asc" }]
  });
  return NextResponse.json({ items });
});

const postSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  baseAmountEur: z.number().positive(),
  minAmountEur: z.number().positive(),
  unit: z.enum(["one_time", "monthly", "hourly"]).default("one_time"),
  tradeoffs: z.array(z.string()).max(20).default([]),
  active: z.boolean().default(true)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (parsed.data.minAmountEur > parsed.data.baseAmountEur) {
    throw new ApiError(400, "validation_error", "minAmountEur no puede ser > baseAmountEur");
  }
  const created = await prisma.pricingService.create({
    data: {
      workspaceId: api.workspaceId,
      ...parsed.data,
      tradeoffs: parsed.data.tradeoffs as any
    }
  });
  return NextResponse.json({ ok: true, item: created }, { status: 201 });
});
