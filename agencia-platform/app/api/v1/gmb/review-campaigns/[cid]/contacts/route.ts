/**
 * Destinatarios de una campaña de reseñas. GET → lista + conteos por estado. POST → añade contactos
 * (consentimiento explícito, deduplicación por hash, respeta la suppression list). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { normalizeContact, contactHash } from "@/lib/gmb/review-acquisition";

export const dynamic = "force-dynamic";

async function loadCampaign(workspaceId: string, cid: string) {
  return prisma.gmbReviewCampaign.findFirst({ where: { id: cid, workspaceId } });
}

const schema = z.object({ contacts: z.array(z.object({ name: z.string().max(120).optional(), phone: z.string().max(30).optional(), email: z.string().max(160).optional(), consent: z.boolean() })).min(1).max(500) });

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const campaign = await loadCampaign(api.workspaceId, (params as any).cid);
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");
  const contacts = await prisma.gmbReviewContact.findMany({ where: { workspaceId: api.workspaceId, campaignId: campaign.id }, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, name: true, phone: true, email: true, consent: true, status: true, lastSentAt: true } });
  const byStatus: Record<string, number> = {};
  for (const c of contacts) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  return NextResponse.json({ ok: true, contacts, byStatus, total: contacts.length });
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const campaign = await loadCampaign(api.workspaceId, (params as any).cid);
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const suppressed = new Set((await prisma.gmbSuppression.findMany({ where: { workspaceId: api.workspaceId }, select: { contactHash: true } })).map((s: any) => s.contactHash));
  const existing = new Set((await prisma.gmbReviewContact.findMany({ where: { workspaceId: api.workspaceId, campaignId: campaign.id }, select: { contactHash: true } })).map((c: any) => c.contactHash));

  let added = 0, skipped = 0;
  for (const raw of parsed.data.contacts) {
    const norm = normalizeContact({ email: raw.email, phone: raw.phone });
    if (!norm) { skipped++; continue; }
    const hash = contactHash(norm.value);
    if (suppressed.has(hash)) { skipped++; continue; } // opt-out respetado
    if (existing.has(hash)) { skipped++; continue; } // dedup
    existing.add(hash);
    await prisma.gmbReviewContact.create({ data: { workspaceId: api.workspaceId, campaignId: campaign.id, clientId: campaign.clientId, name: raw.name ?? "", phone: raw.phone ?? "", email: raw.email ?? "", contactHash: hash, consent: raw.consent, consentAt: raw.consent ? new Date() : null, status: "queued" } });
    added++;
  }
  return NextResponse.json({ ok: true, added, skipped });
});
