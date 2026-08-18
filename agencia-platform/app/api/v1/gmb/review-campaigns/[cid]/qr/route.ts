/**
 * GET /api/v1/gmb/review-campaigns/[cid]/qr — PNG del QR que apunta a la landing pública de reseñas.
 * Tenant-scoped (sesión). El QR solo codifica una URL pública; no expone nada sensible.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const campaign = await prisma.gmbReviewCampaign.findFirst({ where: { id: (params as any).cid, workspaceId: api.workspaceId } });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");
  const origin = new URL(req.url).origin;
  const url = `${origin}/gmb-review/${campaign.publicSlug}`;
  const QRCode = (await import("qrcode")).default;
  const png = await QRCode.toBuffer(url, { type: "png", width: 320, margin: 2 });
  return new NextResponse(png as any, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" } });
});
