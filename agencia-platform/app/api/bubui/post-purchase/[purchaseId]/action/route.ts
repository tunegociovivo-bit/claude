/**
 * Acciones post-compra que dan descuento para la PRÓXIMA visita.
 *
 * GET  → datos para la pantalla "gana descuento": negocio, acciones activas con
 *        su % y cuáles ya ha completado el cliente.
 * POST → el cliente completa una acción (compartir/reseña/seguir/foto). Para
 *        reseña/seguir/foto sube una captura que valida la IA; compartir es
 *        provisional. Si pasa, crea un BubuiOffer con el % de ESA acción.
 *
 * Auth: cabecera del cliente (customerAuthOk), debe ser el dueño de la compra.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { actionPct, enabledActions, type PPActionKey } from "@/lib/bubui/post-purchase";
import { mesaReviewUrl } from "@/lib/bubui/table";
import { uploadBuffer, signedDownloadUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadPurchase(purchaseId: string) {
  return prisma.bubuiPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true, customerId: true, businessId: true, status: true,
      business: {
        select: {
          id: true, name: true, shareOfferPct: true, reviewRewardPct: true,
          ppFollowDiscountPct: true, ppPhotoDiscountPct: true, mesaNextVisitDays: true,
          googlePlaceId: true, instagramUrl: true, facebookUrl: true,
          mesaReviewPlatform: true, trustpilotUrl: true, tripadvisorUrl: true
        }
      }
    }
  });
}

export async function GET(req: Request, { params }: { params: { purchaseId: string } }) {
  const p = await loadPurchase(params.purchaseId);
  if (!p) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (!(await customerAuthOk(req, p.customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const actions = enabledActions(p.business);
  // Acciones ya completadas (cupón creado para esta compra).
  const done = await prisma.bubuiOffer.findMany({
    where: { customerId: p.customerId, businessId: p.businessId, triggerBusinessId: { startsWith: `pp:${p.id}:` } },
    select: { triggerBusinessId: true }
  });
  const doneKeys = new Set(done.map((d) => (d.triggerBusinessId ?? "").split(":")[2]));
  const [alreadyReviewed, alreadyFollowed] = await Promise.all([
    prisma.bubuiGoogleReview.findUnique({ where: { customerId_businessId: { customerId: p.customerId, businessId: p.businessId } }, select: { id: true } }).catch(() => null),
    prisma.bubuiSocialFollow.findUnique({ where: { customerId_businessId: { customerId: p.customerId, businessId: p.businessId } }, select: { id: true } }).catch(() => null)
  ]);

  return NextResponse.json({
    ok: true,
    business: { id: p.business.id, name: p.business.name, googlePlaceId: p.business.googlePlaceId, instagramUrl: p.business.instagramUrl, facebookUrl: p.business.facebookUrl, reviewUrl: mesaReviewUrl(p.business) },
    actions: actions.map((a) => ({
      ...a,
      done: doneKeys.has(a.key),
      blocked: (a.key === "review" && !!alreadyReviewed) || (a.key === "follow" && !!alreadyFollowed)
    }))
  });
}

export async function POST(req: Request, { params }: { params: { purchaseId: string } }) {
  const p = await loadPurchase(params.purchaseId);
  if (!p) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (!(await customerAuthOk(req, p.customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const action = String(form?.get("action") ?? "") as PPActionKey;
  if (!["share", "review", "follow", "photo"].includes(action)) {
    return NextResponse.json({ error: { code: "bad_action", message: "Acción no válida." } }, { status: 400 });
  }
  const pct = actionPct(p.business, action);
  if (pct <= 0) {
    return NextResponse.json({ error: { code: "action_off", message: "Este negocio no ofrece esa acción." } }, { status: 409 });
  }
  if (action === "review") {
    const already = await prisma.bubuiGoogleReview
      .findUnique({ where: { customerId_businessId: { customerId: p.customerId, businessId: p.businessId } }, select: { id: true } })
      .catch(() => null);
    if (already) {
      return NextResponse.json({ error: { code: "already_reviewed", message: "Ya dejaste una reseña de este negocio." } }, { status: 409 });
    }
  }
  if (action === "follow") {
    const already = await prisma.bubuiSocialFollow
      .findUnique({ where: { customerId_businessId: { customerId: p.customerId, businessId: p.businessId } }, select: { id: true } })
      .catch(() => null);
    if (already) {
      return NextResponse.json({ error: { code: "already_followed", message: "Ya sigues a este negocio." } }, { status: 409 });
    }
  }

  const trigger = `pp:${p.id}:${action}`;
  const existing = await prisma.bubuiOffer.findUnique({
    where: { customerId_businessId_triggerBusinessId: { customerId: p.customerId, businessId: p.businessId, triggerBusinessId: trigger } },
    select: { id: true }
  }).catch(() => null);
  if (existing) {
    return NextResponse.json({ ok: true, alreadyClaimed: true, discountPct: pct });
  }

  let provisional = false;
  let reason = "";

  // Compartir: provisional (el negocio lo verifica al canjear). Reseña/seguir/
  // foto: captura validada por IA.
  if (action !== "share") {
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: { code: "no_file", message: "Sube una captura para verificar la acción." } }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mimeType = (file as any).type || "image/jpeg";
    if (buf.length > 8 * 1024 * 1024) {
      return NextResponse.json({ error: { code: "too_big", message: "Imagen demasiado grande (máx 8MB)." } }, { status: 400 });
    }
    const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    const safe = p.customerId.replace(/[^\w-]+/g, "").slice(0, 40) || "anon";
    const s3Key = `bubui/pp/${p.id}/${safe}-${action}-${Date.now()}.${ext}`;
    try {
      await uploadBuffer({ s3Key, body: buf, contentType: mimeType });
    } catch (e: any) {
      return NextResponse.json({ error: { code: "upload_failed", message: `No se pudo guardar la captura: ${e?.message ?? e}` } }, { status: 502 });
    }
    const shotUrl = await signedDownloadUrl(s3Key, 60 * 60 * 24 * 6);

    const today = new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
    const platform = (p.business.mesaReviewPlatform || "google") === "google" ? "Google" : (p.business.mesaReviewPlatform || "Google");
    const system =
      action === "review"
        ? `Eres un verificador de capturas. HOY es ${today}. La captura DEBE ser una reseña PUBLICADA HOY en ${platform} del negocio "${p.business.name}". Válida solo si se ve que es ${platform}, es una reseña publicada de "${p.business.name}" y su fecha es RECIENTE (hoy). Si es antigua, NO válida (confidence 0.9). Responde SOLO JSON: {"valid":boolean,"confidence":0..1,"reason":"motivo breve"}.`
        : action === "follow"
        ? `Eres un verificador de capturas. La captura DEBE mostrar que el usuario SIGUE el perfil de Instagram o Facebook de "${p.business.name}" (botón "Siguiendo"/"Following"). Si no se ve que sigue, NO válida. Responde SOLO JSON: {"valid":boolean,"confidence":0..1,"reason":"motivo breve"}.`
        : `Eres un verificador de capturas. HOY es ${today}. La captura DEBE ser una PUBLICACIÓN en redes (historia/post) con una FOTO que ETIQUETA o MENCIONA a "${p.business.name}", publicada HOY. Si es antigua o no etiqueta, NO válida. Responde SOLO JSON: {"valid":boolean,"confidence":0..1,"reason":"motivo breve"}.`;
    const PROV = "No hemos podido confirmarla con seguridad: el cupón queda activo y el negocio lo verificará al canjearlo.";
    try {
      const { completeVision } = await import("@/lib/ai/anthropic");
      const raw = await completeVision({
        workspaceId: "bubui-system",
        model: "claude-haiku-4-5-20251001",
        feature: "bubui-pp-verify",
        maxTokens: 200,
        imageUrls: [shotUrl],
        system,
        userText: "¿Cumple la acción descrita?"
      });
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        const conf = typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0;
        if (j.valid === true && conf >= 0.6) { /* válida */ }
        else if (conf < 0.6) { provisional = true; reason = PROV; }
        else {
          // Rechazo claro de la IA. Para SEGUIR en redes lo damos por válido
          // igualmente (no se puede rehacer y es de bajo abuso); para reseña/
          // foto sí rechazamos.
          if (action !== "follow") {
            return NextResponse.json({ ok: false, valid: false, reason: typeof j.reason === "string" ? j.reason : "No hemos podido validar la captura." });
          }
        }
      } else {
        provisional = true; reason = PROV;
      }
    } catch {
      provisional = true; reason = PROV;
    }

    // SEGUIR en redes: como cada usuario solo puede seguir una vez, si la IA no
    // logra verificarlo se da por válido automáticamente (no provisional).
    if (action === "follow") {
      provisional = false;
      reason = "";
    }

    // Reseña de Google verificada de verdad → marca para no volver a pedirla.
    if (action === "review" && !provisional) {
      await prisma.bubuiGoogleReview
        .upsert({ where: { customerId_businessId: { customerId: p.customerId, businessId: p.businessId } }, create: { customerId: p.customerId, businessId: p.businessId }, update: {} })
        .catch(() => {});
    }
    // Seguir verificado → marca para no volver a ofrecer "seguir" de este negocio.
    if (action === "follow") {
      await prisma.bubuiSocialFollow
        .upsert({ where: { customerId_businessId: { customerId: p.customerId, businessId: p.businessId } }, create: { customerId: p.customerId, businessId: p.businessId }, update: {} })
        .catch(() => {});
    }
  }

  const days = p.business.mesaNextVisitDays ?? 30;
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await prisma.bubuiOffer.create({
    data: {
      customerId: p.customerId,
      businessId: p.businessId,
      discountPct: pct,
      triggerBusinessId: trigger,
      source: "post_purchase",
      active: true,
      activatedProvisional: provisional,
      expiresAt
    }
  });

  return NextResponse.json({
    ok: true,
    valid: true,
    provisional,
    discountPct: pct,
    reason: reason || `¡Cupón del ${pct}% activado para tu próxima visita! 🎉`
  });
}
