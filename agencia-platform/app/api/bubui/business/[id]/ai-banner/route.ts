/**
 * POST /api/bubui/business/[id]/ai-banner   (Authorization: Bearer <token negocio>)
 *
 * Genera un BANNER de portada a partir de la FOTO DEL ESCAPARATE del negocio
 * (image-to-image, gpt-image-2) con el nombre del comercio compuesto encima.
 *
 * Body: multipart/form-data con:
 *   - file: la foto del escaparate (obligatoria).
 *   - name: el nombre del negocio a rotular (opcional → usa el del negocio).
 *
 * Política de uso (controlada en servidor, no en el cliente):
 *   - La PRIMERA generación es GRATIS (aiBannerUsed == 0).
 *   - A partir de ahí hace falta 1 crédito (aiBannerCredits > 0), que se
 *     compra a 1€ vía /api/bubui/stripe/checkout-ai-banner.
 *   - Cada generación con éxito consume el crédito (o el cupo gratis) y suma
 *     aiBannerUsed.
 *
 * Devuelve { url, stored, remainingCredits }.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { isPaidPlan } from "@/lib/bubui/plan";
import { getAiBannerPolicy } from "@/lib/bubui/ai-banner-settings";
import { generateBusinessBanner, isPhotoAiEnabledAsync } from "@/lib/bubui/photo";
import { isStorageEnabled, uploadBuffer, signedDownloadUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // gpt-image-2 con edición tarda

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB de entrada (se reduce antes de IA)

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  if (!(await isPhotoAiEnabledAsync())) {
    return NextResponse.json(
      { error: { code: "ai_off", message: "Banner IA no configurado: añade la API key de OpenAI en el Hub (Admin → IA) o como OPENAI_API_KEY." } },
      { status: 503 }
    );
  }

  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { name: true, category: true, plan: true, aiBannerUsed: true, aiBannerCredits: true }
  });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  // ── Política de acceso por plan (configurable por el admin) ──
  if ((await getAiBannerPolicy()) === "paid" && !isPaidPlan(business.plan)) {
    return NextResponse.json(
      { error: { code: "plan_required", message: "El Banner IA está disponible solo para planes Pro o Premium." } },
      { status: 402 }
    );
  }

  // ── Política de uso: gratis la primera, luego crédito de pago ──
  const free = business.aiBannerUsed === 0;
  if (!free && business.aiBannerCredits <= 0) {
    return NextResponse.json(
      {
        error: {
          code: "payment_required",
          message: "Ya usaste tu banner IA gratuito. Cada nueva edición cuesta 1€.",
          needsPayment: true
        }
      },
      { status: 402 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const nameRaw = (form?.get("name") as string | null)?.trim();
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: { code: "no_file", message: "Sube una foto del escaparate de tu negocio." } },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: { code: "too_large", message: "La foto supera 12 MB. Usa una más ligera." } },
      { status: 413 }
    );
  }
  const mimeType = file.type || "image/jpeg";
  if (!ALLOWED.includes(mimeType)) {
    return NextResponse.json(
      { error: { code: "bad_type", message: "Formato no soportado. Usa JPG, PNG o WEBP." } },
      { status: 415 }
    );
  }
  const businessName = nameRaw || business.name;
  if (!businessName) {
    return NextResponse.json(
      { error: { code: "no_name", message: "Indica el nombre de tu negocio para rotularlo." } },
      { status: 400 }
    );
  }

  // ── Generación (lo caro) ──
  let pngBase64: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const out = await generateBusinessBanner({
      businessName,
      category: business.category,
      imageBuffer: buf,
      mimeType
    });
    pngBase64 = out.pngBase64;
  } catch (e: any) {
    const detail = String(e?.message ?? e);
    console.error("[bubui ai-banner]", detail);
    // Pista accionable (sin filtrar secretos); el mensaje de OpenAI ya viene
    // recortado desde generateBusinessBanner.
    let hint = "No se pudo generar el banner. Inténtalo de nuevo.";
    if (/api key|401|invalid_api_key/i.test(detail)) {
      hint = "El Banner IA no está bien configurado (API key de OpenAI). Avísanos.";
    } else if (/must be verified|verify|access|unsupported|model/i.test(detail)) {
      hint = "El modelo de imagen no está disponible para esta cuenta de OpenAI. Avísanos para activarlo.";
    } else if (/billing|quota|insufficient|429/i.test(detail)) {
      hint = "Límite temporal del servicio de imágenes. Prueba de nuevo en unos minutos.";
    } else if (/timeout|aborted/i.test(detail)) {
      hint = "La generación tardó demasiado. Prueba con una foto más ligera.";
    }
    return NextResponse.json(
      { error: { code: "generation_failed", message: hint, detail: detail.slice(0, 300) } },
      { status: 502 }
    );
  }

  // ── Consumir cupo gratis / crédito (best-effort, atómico por condición) ──
  let remainingCredits = business.aiBannerCredits;
  try {
    if (free) {
      await prisma.bubuiBusiness.update({
        where: { id: params.id },
        data: { aiBannerUsed: { increment: 1 } }
      });
    } else {
      const r = await prisma.bubuiBusiness.updateMany({
        where: { id: params.id, aiBannerCredits: { gt: 0 } },
        data: { aiBannerCredits: { decrement: 1 }, aiBannerUsed: { increment: 1 } }
      });
      remainingCredits = Math.max(0, business.aiBannerCredits - (r.count > 0 ? 1 : 0));
    }
  } catch (e: any) {
    console.warn("[bubui ai-banner counter]", e?.message ?? e);
  }

  // ── Almacenamiento ──
  if (isStorageEnabled()) {
    try {
      const buf = Buffer.from(pngBase64, "base64");
      const key = `bubui/ai-banner/${params.id}/${Date.now()}.png`;
      await uploadBuffer({ s3Key: key, body: buf, contentType: "image/png" });
      const url = await signedDownloadUrl(key, 7 * 24 * 3600);
      return NextResponse.json({ ok: true, url, stored: true, remainingCredits });
    } catch (e: any) {
      console.warn("[bubui ai-banner storage]", e?.message ?? e);
    }
  }

  return NextResponse.json({
    ok: true,
    url: `data:image/png;base64,${pngBase64}`,
    stored: false,
    remainingCredits
  });
}
