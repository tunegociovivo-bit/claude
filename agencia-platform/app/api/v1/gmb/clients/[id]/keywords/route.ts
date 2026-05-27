/**
 * GET    /api/v1/gmb/clients/[id]/keywords → keywords + última posición conocida
 * POST   /api/v1/gmb/clients/[id]/keywords → añade keyword { keyword, isPrimary? }
 * DELETE /api/v1/gmb/clients/[id]/keywords?keyword=... → elimina keyword
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

async function ensureClient(id: string, workspaceId: string) {
  const c = await prisma.gmbClient.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  return c;
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const keywords = await prisma.gmbKeyword.findMany({
    where: { clientId: params.id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
  });
  // Última posición por keyword
  const latest = await prisma.gmbPosition.findMany({
    where: { clientId: params.id },
    orderBy: { checkedAt: "desc" },
    take: 50
  });
  const lastByKw = new Map<string, any>();
  for (const p of latest) if (!lastByKw.has(p.keyword)) lastByKw.set(p.keyword, p);
  return NextResponse.json({
    keywords: keywords.map((k) => {
      const p = lastByKw.get(k.keyword);
      return {
        id: k.id,
        keyword: k.keyword,
        isPrimary: k.isPrimary,
        avgPosition: p?.avgPosition ?? null,
        top3Count: p?.top3Count ?? null,
        checkedAt: p?.checkedAt ?? null
      };
    })
  });
});

const createSchema = z.object({ keyword: z.string().min(1).max(120), isPrimary: z.boolean().optional() });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const kw = await prisma.gmbKeyword.upsert({
    where: { clientId_keyword: { clientId: params.id, keyword: parsed.data.keyword } },
    create: {
      workspaceId: api.workspaceId,
      clientId: params.id,
      keyword: parsed.data.keyword,
      isPrimary: parsed.data.isPrimary ?? false
    },
    update: { isPrimary: parsed.data.isPrimary ?? undefined }
  });
  return NextResponse.json({ keyword: kw });
});

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const kw = new URL(req.url).searchParams.get("keyword") ?? "";
  await prisma.gmbKeyword.deleteMany({ where: { clientId: params.id, keyword: kw } });
  return NextResponse.json({ ok: true });
});
