/**
 * GET /api/v1/gmb/public/funnel/[slug]/go?s=N — registra el clic y redirige al enlace de reseña de
 * Google del negocio. Disponible para CUALQUIER valoración (sin review gating). Público, rate-limited.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const limited = rateLimitPublic(req, { tag: "gmb-funnel-go", limit: 120 });
  if (limited) return limited;
  const f = await prisma.gmbReviewFunnel.findUnique({ where: { slug } });
  if (!f) return NextResponse.redirect("https://www.google.com/maps", 302);
  const s = Number(new URL(req.url).searchParams.get("s"));
  const stars = Number.isInteger(s) && s >= 1 && s <= 5 ? s : null;
  await prisma.gmbReviewFunnelEvent.create({ data: { workspaceId: f.workspaceId, funnelId: f.id, type: "google", stars } }).catch(() => {});
  return NextResponse.redirect(f.reviewUrl, 302);
}
