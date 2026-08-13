import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ingestOpportunitySignal } from "@/lib/opportunity-hunter/service";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const db = prisma as any;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const type = url.searchParams.get("type") || undefined;
  const tier = url.searchParams.get("tier") || undefined;
  const q = url.searchParams.get("q")?.trim() || undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 300);
  const where: any = { workspaceId: api.workspaceId };
  if (status) where.status = status;
  if (type) where.type = type;
  if (tier) where.tier = tier;
  if (q) where.OR = [{ companyName: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }];
  const [items, total, hot, converted] = await Promise.all([
    db.opportunitySignal.findMany({ where, orderBy: [{ score: "desc" }, { occurredAt: "desc" }, { discoveredAt: "desc" }], take: limit }),
    db.opportunitySignal.count({ where: { workspaceId: api.workspaceId } }),
    db.opportunitySignal.count({ where: { workspaceId: api.workspaceId, tier: "hot", status: { not: "dismissed" } } }),
    db.opportunitySignal.count({ where: { workspaceId: api.workspaceId, status: "converted" } })
  ]);
  return NextResponse.json({ items, stats: { total, hot, converted } });
});

export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const records = Array.isArray(body) ? body : [body];
  if (!records.length || records.length > 100) throw new ApiError(400, "validation_error", "Envía entre 1 y 100 señales");
  const items = [];
  for (const record of records) items.push(await ingestOpportunitySignal(prisma as any, api.workspaceId, record));
  return NextResponse.json({ ok: true, accepted: items.length, items }, { status: 201 });
});
