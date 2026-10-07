/** GET /api/v1/gmb/review-funnels/[id]/qr[?target=google] — PNG del QR de la página de valoración (o del enlace directo de Google). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { publicBaseUrl } from "@/lib/public-url";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { funnelPublicUrl } from "@/lib/gmb/review-funnel";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const f = await prisma.gmbReviewFunnel.findFirst({ where: { id: (params as any).id, workspaceId: api.workspaceId } });
  if (!f) throw new ApiError(404, "not_found", "Embudo no encontrado");
  const u = new URL(req.url);
  const url = u.searchParams.get("target") === "google" ? f.reviewUrl : funnelPublicUrl(publicBaseUrl(req), f.slug);
  const QRCode = (await import("qrcode")).default;
  const png = await QRCode.toBuffer(url, { type: "png", width: 640, margin: 2 });
  const headers: Record<string, string> = { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" };
  if (u.searchParams.get("download")) headers["Content-Disposition"] = `attachment; filename="qr-${f.slug}.png"`;
  return new NextResponse(png as any, { headers });
});
