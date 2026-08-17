/**
 * POST /api/v1/gmb/review-campaigns/[cid]/send — envío ADAPTER-GATED de la campaña de reseñas.
 * Solo WhatsApp está cableado (vía WAHA); sin adapter → bloqueo honesto "sin_adapter". Respeta
 * consentimiento, suppression list y rate limits. Nunca simula un envío. Tenant-scoped, idempotente.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { canSend, renderTemplate } from "@/lib/gmb/review-acquisition";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const campaign = await prisma.gmbReviewCampaign.findFirst({ where: { id: (params as any).cid, workspaceId: api.workspaceId } });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");
  const client = await prisma.gmbClient.findFirst({ where: { id: campaign.clientId, workspaceId: api.workspaceId }, select: { name: true } });

  // Solo WhatsApp es un canal de PUSH cableado. Link/QR son pull (no se "envían"). Email/SMS: sin adapter.
  if (campaign.channel !== "whatsapp") {
    return NextResponse.json({ ok: true, blocked: true, reason: "canal_no_push", note: `El canal «${campaign.channel}» no envía mensajes (usa el enlace/QR público). Para envíos automáticos, crea una campaña de WhatsApp.` });
  }
  // Adapter-gated: WAHA debe estar configurado.
  try {
    const { getWahaConfig } = await import("@/lib/leads/waha");
    const cfg = await getWahaConfig(api.workspaceId);
    if (!cfg || !(cfg as any).baseUrl) throw new Error("no_config");
  } catch {
    return NextResponse.json({ ok: true, blocked: true, reason: "sin_adapter", note: "WhatsApp (WAHA) no está conectado. Configúralo para enviar. No se simula ningún envío." });
  }

  const origin = new URL(req.url).origin;
  const suppressed = new Set((await prisma.gmbSuppression.findMany({ where: { workspaceId: api.workspaceId }, select: { contactHash: true } })).map((s: any) => s.contactHash));
  const contacts = await prisma.gmbReviewContact.findMany({ where: { workspaceId: api.workspaceId, campaignId: campaign.id, status: { in: ["queued", "sent"] } }, take: 50 });

  const { sendText } = await import("@/lib/leads/waha");
  let sent = 0; const skipped: Record<string, number> = {};
  for (const c of contacts) {
    const gate = canSend({ consent: c.consent, suppressed: suppressed.has(c.contactHash), lastSentAt: c.lastSentAt, sentCount: c.status === "sent" ? 1 : 0 });
    if (!gate.ok) { skipped[gate.reason ?? "skip"] = (skipped[gate.reason ?? "skip"] ?? 0) + 1; continue; }
    if (!c.phone) { skipped.sin_telefono = (skipped.sin_telefono ?? 0) + 1; continue; }
    const optout = `${origin}/gmb-optout/${c.optOutToken}`;
    const text = renderTemplate(campaign.message, { nombre: c.name, negocio: client?.name ?? "", enlace: `${origin}/gmb-review/${campaign.publicSlug}`, optout });
    try {
      await sendText({ workspaceId: api.workspaceId, phoneNormalized: c.phone.replace(/[^\d]/g, ""), text });
      await prisma.gmbReviewContact.updateMany({ where: { id: c.id, workspaceId: api.workspaceId }, data: { status: "sent", lastSentAt: new Date(), lastError: null } });
      sent++;
    } catch (e: any) {
      await prisma.gmbReviewContact.updateMany({ where: { id: c.id, workspaceId: api.workspaceId }, data: { status: "error", lastError: String(e?.message ?? "error").slice(0, 160) } });
      skipped.error = (skipped.error ?? 0) + 1;
    }
  }
  return NextResponse.json({ ok: true, blocked: false, sent, skipped });
});
