/**
 * Campañas de captación de reseñas (QR/link/multicanal). GET → lista con URL pública + review URL.
 * POST → crea (comprueba compliance: sin incentivos ni review gating). Tenant-scoped.
 * La reseña va SIEMPRE a Google para TODOS (sin filtrar por sentimiento).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { buildGmbReviewUrl } from "@/lib/reviews/gmb-link";
import { checkCompliance, defaultTemplate } from "@/lib/gmb/review-acquisition";

export const dynamic = "force-dynamic";

const schema = z.object({ name: z.string().min(1).max(120), channel: z.enum(["qr", "link", "whatsapp", "sms", "email"]).optional(), message: z.string().max(1000).optional() });

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const origin = new URL(req.url).origin;
  const campaigns = await prisma.gmbReviewCampaign.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const items = await Promise.all(campaigns.map(async (c: any) => {
    const [contacts, sent, clicked] = await Promise.all([
      prisma.gmbReviewContact.count({ where: { workspaceId: api.workspaceId, campaignId: c.id } }),
      prisma.gmbReviewContact.count({ where: { workspaceId: api.workspaceId, campaignId: c.id, status: "sent" } }),
      prisma.gmbReviewContact.count({ where: { workspaceId: api.workspaceId, campaignId: c.id, status: "clicked" } })
    ]);
    return { ...c, publicUrl: `${origin}/gmb-review/${c.publicSlug}`, qrUrl: `${origin}/api/v1/gmb/review-campaigns/${c.id}/qr`, metrics: { contacts, sent, clicked } };
  }));
  return NextResponse.json({ ok: true, campaigns: items });
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const message = parsed.data.message ?? defaultTemplate();
  const compliance = checkCompliance(message);
  if (!compliance.ok) throw new ApiError(422, "compliance", compliance.issues.join(" "));
  // La URL de reseña va a Google (placeId de la ficha) — para todos, sin gating.
  const reviewUrl = (client.placeId ? buildGmbReviewUrl(client.placeId) : "") || "";
  const c = await prisma.gmbReviewCampaign.create({ data: { workspaceId: api.workspaceId, clientId: client.id, name: parsed.data.name, channel: parsed.data.channel ?? "link", message, reviewUrl, createdById: api.userId ?? null } });
  const origin = new URL(req.url).origin;
  return NextResponse.json({ ok: true, campaign: { ...c, publicUrl: `${origin}/gmb-review/${c.publicSlug}`, qrUrl: `${origin}/api/v1/gmb/review-campaigns/${c.id}/qr` }, reviewUrlReady: !!reviewUrl });
});
