/**
 * POST /api/bubui/offer/[offerId]/verify-action   (multipart/form-data)
 *
 * Activación ALTERNATIVA de un cupón-reto (source share_challenge) sin depender
 * de que los amigos se registren: el usuario sube una CAPTURA (reseña en
 * Google/{plataforma} o publicación social etiquetando al negocio) y la IA la
 * valida. Si es válida, el cupón se ACTIVA al instante.
 *
 * Restricción de crecimiento: esta vía SOLO está disponible para usuarios que ya
 * han conseguido ALT_ACTION_MIN_REFERRALS (10) amigos dados de alta con su
 * enlace. Por debajo de eso, la única vía es compartir (la meta nº1 es crecer).
 *
 * Body (form-data): file (imagen) + customerId + type ("review" | "social").
 * Respuesta: { ok, valid, provisional, reason, activated }.
 *
 * Si la IA no puede validar con seguridad (caída o duda) → activación PROVISIONAL
 * marcada para que el negocio la verifique. Si rechaza con seguridad → no activa.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { mesaReviewUrl, mesaReviewPlatformLabel } from "@/lib/bubui/table";
import { countVerifiedReferrals } from "@/lib/bubui/referral";
import { getAltActionMinReferrals } from "@/lib/bubui/growth-settings";
import { isStorageEnabled, uploadBuffer, signedDownloadUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

export async function POST(req: Request, { params }: { params: { offerId: string } }) {
  if (!isStorageEnabled()) {
    return NextResponse.json({ error: { code: "storage_disabled", message: "Storage no configurado." } }, { status: 503 });
  }

  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  // customerId/type por QUERY (los campos de texto del multipart se pierden a
  // veces en RN/Android); fallback al form por si acaso.
  const customerId =
    url.searchParams.get("customerId") || (typeof form?.get("customerId") === "string" ? (form!.get("customerId") as string) : "");
  const type =
    url.searchParams.get("type") || (typeof form?.get("type") === "string" ? (form!.get("type") as string) : "");

  if (!customerId) return NextResponse.json({ error: { code: "no_customer", message: "Falta customerId." } }, { status: 400 });
  if (type !== "review" && type !== "social") {
    return NextResponse.json({ error: { code: "bad_type", message: "type debe ser 'review' o 'social'." } }, { status: 400 });
  }
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: { code: "no_file", message: "Falta la captura." } }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: { code: "too_large", message: "La imagen supera 10 MB." } }, { status: 413 });
  }
  const mimeType = file.type || "image/jpeg";
  if (!ALLOWED.includes(mimeType)) {
    return NextResponse.json({ error: { code: "bad_format", message: "Formato no soportado (usa JPG/PNG)." } }, { status: 415 });
  }

  // Cupón-reto del usuario, bloqueado y vigente.
  const offer = await prisma.bubuiOffer.findFirst({
    where: { id: params.offerId, customerId, source: "share_challenge", active: false, redeemed: false, expiresAt: { gt: new Date() } },
    include: { business: true }
  });
  if (!offer) {
    return NextResponse.json({ error: { code: "not_found", message: "Cupón no encontrado, ya activo o caducado." } }, { status: 404 });
  }

  // Puerta de crecimiento: la vía por acción solo se abre con el umbral de amigos
  // de alta (configurable por el admin).
  const verified = await countVerifiedReferrals(customerId);
  const altMin = await getAltActionMinReferrals();
  if (verified < altMin) {
    return NextResponse.json(
      { error: { code: "locked", message: `Esta vía se desbloquea al conseguir ${altMin} amigos dados de alta (llevas ${verified}). Sigue compartiendo.` } },
      { status: 403 }
    );
  }

  const b = offer.business;
  if (type === "review" && !mesaReviewUrl(b)) {
    return NextResponse.json({ error: { code: "action_off", message: "Este negocio no tiene reseña configurada." } }, { status: 409 });
  }

  // 1) Guardar la captura.
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const safe = customerId.replace(/[^\w-]+/g, "").slice(0, 40) || "anon";
  const s3Key = `bubui/challenge/${offer.id}/${safe}-${type}-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    await uploadBuffer({ s3Key, body: buf, contentType: mimeType });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "upload_failed", message: `No se pudo guardar la captura: ${e?.message ?? e}` } }, { status: 502 });
  }
  const shotUrl = await signedDownloadUrl(s3Key, 60 * 60 * 24 * 30);

  // 2) Validar con IA.
  const platform = mesaReviewPlatformLabel(b);
  let valid = false;
  let provisional = false;
  let reason = "";
  const PROVISIONAL_MSG = "No hemos podido confirmarla con seguridad: el cupón queda activo de forma provisional y el negocio lo verificará al canjearlo.";
  try {
    const { completeVision } = await import("@/lib/ai/anthropic");
    const system =
      type === "review"
        ? `Eres un verificador de capturas. La captura DEBE ser una reseña PUBLICADA en ${platform} del restaurante "${b.name}". Es válida si se ve que es ${platform}, es una reseña ya publicada y corresponde a "${b.name}" (tolera recortes y nombres parecidos; rechaza si claramente no es una reseña o es de otro sitio). Responde SOLO JSON: {"valid": boolean, "confidence": 0..1, "reason": "motivo breve en español"}.`
        : `Eres un verificador de capturas. La captura DEBE ser una PUBLICACIÓN en una red social (Instagram/Facebook/TikTok/X/Stories) con una FOTO que ETIQUETA o MENCIONA al restaurante "${b.name}". Es válida si se ve que es una red social, hay foto y aparece el nombre/etiqueta de "${b.name}" (tolera recortes; rechaza si no es una publicación social o no menciona al sitio). Responde SOLO JSON: {"valid": boolean, "confidence": 0..1, "reason": "motivo breve en español"}.`;
    const raw = await completeVision({
      workspaceId: "bubui-system",
      model: "claude-haiku-4-5-20251001",
      feature: "bubui-challenge-verify",
      maxTokens: 200,
      imageUrls: [shotUrl],
      system,
      userText: type === "review" ? "¿Es una reseña publicada de este restaurante?" : "¿Es una publicación social que etiqueta a este restaurante?"
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      const conf = typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0;
      reason = typeof j.reason === "string" ? j.reason : "";
      if (j.valid === true && conf >= 0.6) valid = true;
      else if (conf < 0.6) { valid = true; provisional = true; reason = PROVISIONAL_MSG; }
      else valid = false;
    } else {
      valid = true; provisional = true; reason = PROVISIONAL_MSG;
    }
  } catch {
    valid = true; provisional = true; reason = PROVISIONAL_MSG;
  }

  // 3) Si es válida (o provisional), ACTIVA el cupón.
  if (valid) {
    await prisma.bubuiOffer.updateMany({
      where: { id: offer.id, active: false },
      data: { active: true, activatedByAction: true, activatedProvisional: provisional, activationShotUrl: shotUrl }
    });
  }

  return NextResponse.json({
    ok: true,
    valid,
    provisional,
    activated: valid,
    reason: reason || (valid ? "¡Cupón activado!" : "No hemos podido validar la captura. Inténtalo de nuevo.")
  });
}
