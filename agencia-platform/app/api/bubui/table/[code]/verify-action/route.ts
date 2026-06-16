/**
 * POST /api/bubui/table/[code]/verify-action   (multipart/form-data)
 *
 * El comensal sube una CAPTURA para aportar una acción VERIFICADA al bote común
 * de la mesa (N acciones = N comensales). La IA (visión) valida que la captura
 * sea de verdad lo que dice ser:
 *   - type="review": una reseña en Google/{plataforma} del restaurante.
 *   - type="social": una publicación en redes (foto) etiquetando al restaurante.
 *
 * Body (form-data): file (imagen) + customerId + type + opcional ticketAmount.
 * Respuesta: { ok, valid, provisional, reason, state }.
 *
 * Cualquier comensal puede subir hasta 2 acciones (una reseña + una social) para
 * cubrir a quien no puede/quiere: el descuento es de la mesa, no por cabeza.
 *
 * Degradación: si no hay IA configurada o falla, se acepta de forma PROVISIONAL
 * (provisional=true) para no bloquear a la mesa; la captura queda guardada para
 * que el negocio pueda auditarla.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { loadTableState, mesaReviewPlatformLabel } from "@/lib/bubui/table";
import { isStorageEnabled, uploadBuffer, signedDownloadUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

export async function POST(req: Request, { params }: { params: { code: string } }) {
  if (!isStorageEnabled()) {
    return NextResponse.json({ error: { code: "storage_disabled", message: "Storage no configurado." } }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const customerId = typeof form?.get("customerId") === "string" ? (form!.get("customerId") as string) : "";
  const type = typeof form?.get("type") === "string" ? (form!.get("type") as string) : "";
  const ticketRaw = form?.get("ticketAmount");
  const ticketAmount = typeof ticketRaw === "string" && ticketRaw ? Number(ticketRaw) : undefined;

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

  // Mesa abierta + participante.
  const session = await prisma.bubuiTableSession.findFirst({
    where: { code: params.code.toUpperCase(), status: "open" },
    include: { business: true, participants: { where: { customerId } } }
  });
  if (!session) return NextResponse.json({ error: { code: "not_found", message: "Mesa no encontrada o cerrada." } }, { status: 404 });
  const me = session.participants[0];
  if (!me) return NextResponse.json({ error: { code: "not_joined", message: "Únete a la mesa primero." } }, { status: 409 });

  const b = session.business;
  // Comprobar que el negocio acepta ese tipo de acción.
  if (type === "review" && !b.mesaActReview) {
    return NextResponse.json({ error: { code: "action_off", message: "Este restaurante no pide reseña." } }, { status: 409 });
  }
  if (type === "social" && !b.mesaActPhoto && !b.mesaActFollow) {
    return NextResponse.json({ error: { code: "action_off", message: "Este restaurante no pide publicación en redes." } }, { status: 409 });
  }

  // 1) Guardar la captura en storage (la necesita la IA y la auditoría del negocio).
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const safe = customerId.replace(/[^\w-]+/g, "").slice(0, 40) || "anon";
  const s3Key = `bubui/mesa/${session.id}/${safe}-${type}-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    await uploadBuffer({ s3Key, body: buf, contentType: mimeType });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "upload_failed", message: `No se pudo guardar la captura: ${e?.message ?? e}` } }, { status: 502 });
  }
  const shotUrl = await signedDownloadUrl(s3Key, 60 * 60 * 24 * 30); // 30 días

  // 2) Validar la captura con la IA.
  const platform = mesaReviewPlatformLabel(b);
  let valid = false;
  const provisional = false; // sin aceptación provisional: si la IA no valida, NO cuenta
  let reason = "";
  try {
    const { completeVision } = await import("@/lib/ai/anthropic");
    const system =
      type === "review"
        ? `Eres un verificador de capturas de pantalla. Te paso una captura que DEBE ser una reseña ` +
          `publicada en ${platform} del restaurante llamado "${b.name}". Es válida si: (a) se ve que es ` +
          `${platform} (interfaz de reseñas), (b) es una reseña ya PUBLICADA (con estrellas o texto), y ` +
          `(c) corresponde al restaurante "${b.name}" (o su nombre aparece de forma razonable). ` +
          `Sé tolerante con recortes y nombres parecidos, pero rechaza capturas que claramente no son ` +
          `una reseña o son de otro sitio. Responde EXCLUSIVAMENTE con JSON: ` +
          `{"valid": boolean, "confidence": 0..1, "reason": "motivo breve en español"}.`
        : `Eres un verificador de capturas de pantalla. Te paso una captura que DEBE ser una PUBLICACIÓN ` +
          `en una red social (Instagram, Facebook, TikTok, X/Twitter, Stories) con una FOTO y que ETIQUETA ` +
          `o MENCIONA al restaurante "${b.name}". Es válida si: (a) se ve que es una red social, (b) hay una ` +
          `foto/imagen, y (c) aparece el nombre o etiqueta del restaurante "${b.name}" (un @, # o mención de texto). ` +
          `Sé tolerante con recortes, pero rechaza capturas que no sean una publicación social o no mencionen al sitio. ` +
          `Responde EXCLUSIVAMENTE con JSON: {"valid": boolean, "confidence": 0..1, "reason": "motivo breve en español"}.`;
    const raw = await completeVision({
      workspaceId: "bubui-system",
      model: "claude-haiku-4-5-20251001",
      feature: "bubui-mesa-verify",
      maxTokens: 200,
      imageUrls: [shotUrl],
      system,
      userText: type === "review" ? "¿Es una reseña publicada de este restaurante?" : "¿Es una publicación social que etiqueta a este restaurante?"
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      const conf = typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0;
      valid = j.valid === true && conf >= 0.6;
      reason = typeof j.reason === "string" ? j.reason : "";
    }
  } catch (e: any) {
    // IA no disponible: la acción NO cuenta (no se acepta sin validar). Que el
    // comensal lo reintente; la captura queda guardada por si hace falta auditar.
    valid = false;
    reason = "No hemos podido validar la captura ahora mismo. Inténtalo de nuevo en un momento.";
  }

  // 3) Si es válida (o provisional), marca la acción verificada del comensal.
  if (valid) {
    const data: any = {};
    if (type === "review") {
      data.reviewVerified = true;
      data.reviewShotUrl = shotUrl;
    } else {
      data.socialVerified = true;
      data.socialShotUrl = shotUrl;
    }
    if (!me.contributedAt) data.contributedAt = new Date();
    await prisma.bubuiTableParticipant.update({ where: { id: me.id }, data });
  }

  const loaded = await loadTableState(session.id, ticketAmount);
  return NextResponse.json({
    ok: true,
    valid,
    provisional,
    reason: reason || (valid ? "Acción verificada." : "No hemos podido validar la captura. Inténtalo de nuevo."),
    state: loaded?.state ?? null
  });
}
