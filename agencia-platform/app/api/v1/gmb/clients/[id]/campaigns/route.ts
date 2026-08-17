/**
 * Campañas / UTM builder por ficha. GET → lista. POST → crea (valida UTMs, devuelve URL + trackURL).
 * DELETE ?campaignId= → elimina. Tenant-scoped. trackId alimenta el tracker público de clicks.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { validateUtm, buildUtmUrl } from "@/lib/gmb/attribution";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(120),
  channel: z.string().max(40).optional(),
  landingUrl: z.string().max(500),
  utmSource: z.string().max(80),
  utmMedium: z.string().max(80),
  utmCampaign: z.string().max(80),
  utmTerm: z.string().max(80).optional(),
  utmContent: z.string().max(80).optional(),
  note: z.string().max(500).optional()
});

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const origin = new URL(req.url).origin;
  const campaigns = await prisma.gmbCampaign.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const items = campaigns.map((c: any) => ({
    ...c,
    utmUrl: buildUtmUrl(c.landingUrl, { source: c.utmSource, medium: c.utmMedium, campaign: c.utmCampaign, term: c.utmTerm, content: c.utmContent }),
    trackUrl: `${origin}/api/v1/gmb/public/track/${c.trackId}?type=click`
  }));
  return NextResponse.json({ ok: true, campaigns: items });
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const v = validateUtm(parsed.data.landingUrl, { source: parsed.data.utmSource, medium: parsed.data.utmMedium, campaign: parsed.data.utmCampaign, term: parsed.data.utmTerm, content: parsed.data.utmContent });
  if (!v.ok) throw new ApiError(400, "validation_error", v.errors.join(" "));
  const c = await prisma.gmbCampaign.create({ data: { workspaceId: api.workspaceId, clientId: client.id, name: parsed.data.name, channel: parsed.data.channel ?? "web", landingUrl: parsed.data.landingUrl, utmSource: parsed.data.utmSource, utmMedium: parsed.data.utmMedium, utmCampaign: parsed.data.utmCampaign, utmTerm: parsed.data.utmTerm ?? "", utmContent: parsed.data.utmContent ?? "", note: parsed.data.note ?? null, createdById: api.userId ?? null } });
  const origin = new URL(req.url).origin;
  return NextResponse.json({ ok: true, campaign: { ...c, utmUrl: v.url, trackUrl: `${origin}/api/v1/gmb/public/track/${c.trackId}?type=click` } });
});

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const campaignId = new URL(req.url).searchParams.get("campaignId") ?? "";
  await prisma.gmbCampaign.deleteMany({ where: { id: campaignId, workspaceId: api.workspaceId, clientId: client.id } });
  return NextResponse.json({ ok: true });
});
