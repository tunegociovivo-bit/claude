/**
 * GET /api/v1/gmb/public/review/[slug]/go?ct=optOutToken — registra el CLICK de una campaña de
 * reseñas y redirige a Google (la reseña va a Google para TODOS, sin filtrar por sentimiento).
 * Público, rate-limited. Si el contacto viene identificado (ct), marca "clicked".
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const rl = rateLimitPublic(req as any, { tag: "gmb-review-go", limit: 240 });
  if (rl && (rl as any).ok === false) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const campaign = await prisma.gmbReviewCampaign.findUnique({ where: { publicSlug: params.slug } });
  const dest = campaign?.reviewUrl || "https://www.google.com/maps";
  if (!campaign) return NextResponse.redirect(dest, 302);

  // Marca el contacto como "clicked" (solo avanza estados no terminales).
  const ct = new URL(req.url).searchParams.get("ct");
  if (ct) {
    await prisma.gmbReviewContact.updateMany({ where: { optOutToken: ct, workspaceId: campaign.workspaceId, campaignId: campaign.id, status: { in: ["queued", "sent"] } }, data: { status: "clicked" } }).catch(() => {});
  }
  return NextResponse.redirect(dest, 302);
}
