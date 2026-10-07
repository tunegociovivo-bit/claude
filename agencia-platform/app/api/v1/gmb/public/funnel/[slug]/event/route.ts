/** POST /api/v1/gmb/public/funnel/[slug]/event { type: "star", stars } — métrica anónima de la página de valoración. */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const limited = rateLimitPublic(req, { tag: "gmb-funnel-event", limit: 60 });
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  const stars = Number(body?.stars);
  if (body?.type !== "star" || !Number.isInteger(stars) || stars < 1 || stars > 5) return NextResponse.json({ ok: false }, { status: 400 });
  const f = await prisma.gmbReviewFunnel.findUnique({ where: { slug }, select: { id: true, workspaceId: true, active: true } });
  if (!f?.active) return NextResponse.json({ ok: false }, { status: 404 });
  await prisma.gmbReviewFunnelEvent.create({ data: { workspaceId: f.workspaceId, funnelId: f.id, type: "star", stars } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
