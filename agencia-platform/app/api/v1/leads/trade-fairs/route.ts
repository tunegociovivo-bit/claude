import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { importTradeFairExhibitors } from "@/lib/leads/trade-fair-exhibitors";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
const schema = z.object({ name: z.string().min(2).max(160), url: z.string().url(), venue: z.string().min(2).max(160), startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), autoQueue: z.boolean().optional(), maxExhibitors: z.number().int().min(1).max(300).optional() });

export const GET = withApi({ scope: "*" }, async (_req, { api }) => NextResponse.json({ items: await prisma.leadSearch.findMany({ where: { workspaceId: api.workspaceId, source: "trade_fair_exhibitors" }, orderBy: { createdAt: "desc" }, take: 30 }) }));
export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try { return NextResponse.json({ ok: true, ...(await importTradeFairExhibitors(api.workspaceId, parsed.data)) }); }
  catch (error: any) { throw new ApiError(400, "fair_import_failed", error?.message ?? "No se pudo importar la feria"); }
});
