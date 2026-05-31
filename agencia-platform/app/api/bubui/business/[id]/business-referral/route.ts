/**
 * GET  /api/bubui/business/[id]/business-referral
 *   Estado del programa de referidos B2B del negocio: enlace para invitar a
 *   otros negocios, progreso hacia la próxima semana de banner, y sus
 *   campañas de banner (en cola / activa / finalizadas).
 *
 * PATCH /api/bubui/business/[id]/business-referral
 *   Sube/actualiza la imagen (y link) de una campaña de banner ganada:
 *   body { campaignId, imageUrl, link? }.
 *
 * Auth: Bearer del negocio.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import {
  BUSINESSES_PER_REWARD,
  countQualifiedBusinessReferrals,
  syncBusinessReferralRewards
} from "@/lib/bubui/business-referral";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!businessTokenAllows(req.headers.get("authorization"), params.id)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { id: true, name: true }
  });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  // Asegura que las recompensas estén al día antes de mostrarlas.
  await syncBusinessReferralRewards(params.id).catch(() => {});

  const qualified = await countQualifiedBusinessReferrals(params.id);
  const totalReferred = await prisma.bubuiBusiness.count({ where: { referrerId: params.id } });
  const towardsNext = qualified % BUSINESSES_PER_REWARD;
  const remaining = BUSINESSES_PER_REWARD - towardsNext;

  const campaigns = await prisma.bubuiBannerCampaign.findMany({
    where: { businessId: params.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, imageUrl: true, link: true, weeks: true, startsAt: true, endsAt: true, createdAt: true }
  });

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    inviteUrl: `${origin}/bubui/registro?ref=${params.id}`,
    qualifiedReferrals: qualified,
    totalReferred,
    businessesPerReward: BUSINESSES_PER_REWARD,
    towardsNext,
    remainingForNext: remaining,
    weeksEarned: Math.floor(qualified / BUSINESSES_PER_REWARD),
    campaigns
  });
}

const patchSchema = z.object({
  campaignId: z.string().min(1),
  imageUrl: z.string().url().max(2000),
  link: z.string().url().max(2000).optional().nullable()
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!businessTokenAllows(req.headers.get("authorization"), params.id)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.issues[0]?.message } }, { status: 400 });
  }
  // La campaña debe pertenecer a este negocio.
  const campaign = await prisma.bubuiBannerCampaign.findUnique({ where: { id: parsed.data.campaignId } });
  if (!campaign || campaign.businessId !== params.id) {
    return NextResponse.json({ error: { code: "not_found", message: "Campaña no encontrada" } }, { status: 404 });
  }
  if (campaign.status === "done") {
    return NextResponse.json({ error: { code: "finished", message: "Esa campaña ya finalizó" } }, { status: 409 });
  }
  const updated = await prisma.bubuiBannerCampaign.update({
    where: { id: campaign.id },
    data: { imageUrl: parsed.data.imageUrl, link: parsed.data.link ?? null }
  });
  return NextResponse.json({ ok: true, campaign: updated });
}
