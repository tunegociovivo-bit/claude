/**
 * GET /api/v1/gmb/public/track/[trackId]?type=click&to=URL — TRACKER público de eventos REALES.
 * Registra un evento de atribución (deduplicado por fingerprint+día) y redirige a la landing.
 * Público (token = trackId de la campaña), rate-limited, sin PII (solo fingerprint hash).
 * Nunca inventa eventos: solo registra los que realmente ocurren al hacer clic en el enlace.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { eventDedupKey, fingerprintOf, type EventType, EVENT_TYPES } from "@/lib/gmb/attribution";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { trackId: string } }) {
  const rl = rateLimitPublic(req as any, { tag: "gmb-track", limit: 240 });
  if (rl && (rl as any).ok === false) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "click") as EventType;
  const to = url.searchParams.get("to");
  const campaign = await prisma.gmbCampaign.findUnique({ where: { trackId: params.trackId } });
  // Aunque no exista la campaña, redirige de forma segura (no rompe el enlace del usuario).
  const dest = safeRedirect(to, campaign?.landingUrl);
  if (!campaign || !EVENT_TYPES.includes(type)) return dest ? NextResponse.redirect(dest, 302) : NextResponse.json({ ok: true });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "0";
  const ua = req.headers.get("user-agent") ?? "";
  const fp = fingerprintOf(ip, ua);
  const dayISO = new Date().toISOString().slice(0, 10);
  const dedupKey = eventDedupKey(campaign.clientId, type, fp, dayISO);
  try {
    // createMany + skipDuplicates aprovecha el unique [workspaceId, dedupKey] → idempotente.
    await prisma.gmbAttributionEvent.createMany({
      data: [{ workspaceId: campaign.workspaceId, clientId: campaign.clientId, campaignId: campaign.id, type, source: campaign.utmSource, medium: campaign.utmMedium, campaign: campaign.utmCampaign, fingerprint: fp, dedupKey }],
      skipDuplicates: true
    });
  } catch { /* nunca romper el redirect por un fallo de registro */ }
  return dest ? NextResponse.redirect(dest, 302) : NextResponse.json({ ok: true });
}

function safeRedirect(to: string | null, fallback?: string): string | null {
  const cand = (to && to.trim()) || (fallback && fallback.trim()) || null;
  if (!cand) return null;
  try { const u = new URL(/^https?:/i.test(cand) ? cand : `https://${cand}`); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null; } catch { return null; }
}
