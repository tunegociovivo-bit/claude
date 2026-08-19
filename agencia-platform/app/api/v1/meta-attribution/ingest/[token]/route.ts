import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
const schema = z.object({ externalLeadId: z.string().trim().min(1).max(200), campaignId: z.string().max(100).nullish(), campaignName: z.string().max(300).nullish(), adsetId: z.string().max(100).nullish(), adsetName: z.string().max(300).nullish(), adId: z.string().max(100).nullish(), adName: z.string().max(300).nullish(), formId: z.string().max(100).nullish(), contactName: z.string().max(300).nullish(), email: z.string().email().max(320).nullish(), phone: z.string().max(50).nullish(), occurredAt: z.coerce.date().optional(), fields: z.record(z.string(), z.unknown()).optional() });

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const profile = await prisma.metaClientProfile.findUnique({ where: { webhookToken: params.token }, select: { workspaceId: true, adAccountId: true } });
  if (!profile) return NextResponse.json({ error: { message: "Token de ingesta no válido" } }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: { message: "Payload no válido" } }, { status: 400 });
  const { occurredAt, fields, ...data } = parsed.data;
  const item = await prisma.metaLeadAttribution.upsert({ where: { workspaceId_adAccountId_externalLeadId: { workspaceId: profile.workspaceId, adAccountId: profile.adAccountId, externalLeadId: data.externalLeadId } }, create: { workspaceId: profile.workspaceId, adAccountId: profile.adAccountId, ...data, occurredAt: occurredAt ?? new Date(), metadata: fields as any }, update: { ...data, ...(occurredAt ? { occurredAt } : {}), metadata: fields as any } });
  return NextResponse.json({ ok: true, id: item.id });
}
