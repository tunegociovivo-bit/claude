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
import { customerAuthOk, customerIdFromAuth } from "@/lib/bubui/customer-auth";
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

  const url = new URL(req.url);
  // Soporta DOS formatos: JSON con la imagen en base64 (app móvil — evita los
  // problemas del multipart en React Native) y multipart/form-data (web).
  const ct = req.headers.get("content-type") || "";
  let customerId = "";
  let type = "";
  let ticketAmount: number | undefined;
  let mimeType = "image/jpeg";
  let buf: Buffer | null = null;

  if (ct.includes("application/json")) {
    const body: any = await req.json().catch(() => ({}));
    customerId = (typeof body.customerId === "string" && body.customerId) || url.searchParams.get("customerId") || customerIdFromAuth(req) || "";
    type = (typeof body.type === "string" && body.type) || url.searchParams.get("type") || "";
    ticketAmount = body.ticketAmount != null ? Number(body.ticketAmount) : undefined;
    if (typeof body.mimeType === "string" && body.mimeType) mimeType = body.mimeType;
    if (typeof body.imageBase64 === "string" && body.imageBase64.length > 0) {
      try { buf = Buffer.from(body.imageBase64, "base64"); } catch { buf = null; }
    }
  } else {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    customerId =
      url.searchParams.get("customerId") ||
      customerIdFromAuth(req) ||
      (typeof form?.get("customerId") === "string" ? (form!.get("customerId") as string) : "");
    type = url.searchParams.get("type") || (typeof form?.get("type") === "string" ? (form!.get("type") as string) : "");
    const ticketRaw = url.searchParams.get("ticketAmount") ?? (typeof form?.get("ticketAmount") === "string" ? (form!.get("ticketAmount") as string) : null);
    ticketAmount = ticketRaw ? Number(ticketRaw) : undefined;
    if (file instanceof Blob && file.size > 0) {
      mimeType = file.type || "image/jpeg";
      buf = Buffer.from(await file.arrayBuffer());
    }
  }

  if (!customerId) return NextResponse.json({ error: { code: "no_customer", message: "Falta customerId." } }, { status: 400 });
  // "photo" (foto en redes) y "follow" (seguir) son acciones independientes; se
  // acepta "social" como alias histórico de "photo".
  const action = type === "social" ? "photo" : type;
  if (action !== "review" && action !== "photo" && action !== "follow") {
    return NextResponse.json({ error: { code: "bad_type", message: "type debe ser 'review', 'photo' o 'follow'." } }, { status: 400 });
  }
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  if (!buf || buf.length === 0) {
    const via = ct.includes("application/json") ? "json" : "multipart";
    return NextResponse.json({ error: { code: "no_file", message: `Falta la captura. [${via}]` } }, { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: { code: "too_large", message: "La imagen supera 10 MB." } }, { status: 413 });
  }
  if (!ALLOWED.includes(mimeType)) {
    return NextResponse.json({ error: { code: "bad_format", message: "Formato no soportado (usa JPG/PNG)." } }, { status: 415 });
  }

  // Mesa abierta + participante.
  let session;
  try {
    session = await prisma.bubuiTableSession.findFirst({
      where: { code: params.code.toUpperCase(), status: "open" },
      include: { business: true, participants: { where: { customerId } } }
    });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "session_query_failed", message: `Consulta mesa: ${e?.message ?? e}` } }, { status: 500 });
  }
  if (!session) return NextResponse.json({ error: { code: "not_found", message: "Mesa no encontrada o cerrada." } }, { status: 404 });
  const me = session.participants[0];
  if (!me) return NextResponse.json({ error: { code: "not_joined", message: "Únete a la mesa primero." } }, { status: 409 });

  const b = session.business;
  // Comprobar que el negocio acepta ese tipo de acción.
  if (action === "review" && !b.mesaActReview) {
    return NextResponse.json({ error: { code: "action_off", message: "Este restaurante no pide reseña." } }, { status: 409 });
  }
  if (action === "photo" && !b.mesaActPhoto) {
    return NextResponse.json({ error: { code: "action_off", message: "Este restaurante no pide foto en redes." } }, { status: 409 });
  }
  if (action === "follow" && !b.mesaActFollow) {
    return NextResponse.json({ error: { code: "action_off", message: "Este restaurante no pide seguir en redes." } }, { status: 409 });
  }

  // 1) Guardar la captura en storage (la necesita la IA y la auditoría del negocio).
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const safe = customerId.replace(/[^\w-]+/g, "").slice(0, 40) || "anon";
  const s3Key = `bubui/mesa/${session.id}/${safe}-${action}-${Date.now()}.${ext}`;
  try {
    await uploadBuffer({ s3Key, body: buf, contentType: mimeType });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "upload_failed", message: `No se pudo guardar la captura: ${e?.message ?? e}` } }, { status: 502 });
  }
  let shotUrl: string;
  try {
    shotUrl = await signedDownloadUrl(s3Key, 60 * 60 * 24 * 6); // 6 días (máx SigV4 < 7 días)
  } catch (e: any) {
    return NextResponse.json({ error: { code: "sign_failed", message: `URL firmada: ${e?.message ?? e}` } }, { status: 500 });
  }

  // 2) Validar la captura con la IA.
  const platform = mesaReviewPlatformLabel(b);
  let valid = false;
  let provisional = false; // true = cuenta pero el camarero debe verificarla a mano
  let reason = "";
  const PROVISIONAL_MSG = "No hemos podido confirmarla con seguridad: cuenta de forma provisional y el camarero la verificará.";
  try {
    const { completeVision } = await import("@/lib/ai/anthropic");
    const today = new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
    const REVIEW_SYS =
      `Eres un verificador de capturas de pantalla. La fecha de HOY es ${today}. Te paso una captura que ` +
      `DEBE ser una reseña PUBLICADA HOY en ${platform} del restaurante "${b.name}", recién dejada en esta ` +
      `visita. Es válida SOLO si se cumplen TODAS: (a) se ve que es ${platform} (interfaz de reseñas); ` +
      `(b) es una reseña ya PUBLICADA (con estrellas o texto) del restaurante "${b.name}" (tolera recortes y ` +
      `nombres parecidos); y (c) la FECHA visible indica que es RECIENTE, de HOY: "ahora", "hace un momento", ` +
      `"hace X minutos", "hace X horas", "hoy", o una fecha absoluta igual a hoy (${today}). ` +
      `Si la fecha indica DÍAS, SEMANAS o MESES (p. ej. "hace 2 semanas", "hace 3 días", "el mes pasado" o una ` +
      `fecha anterior a hoy), NO es válida: es una reseña antigua o de otra persona, no de esta visita → ` +
      `responde valid:false con confidence ALTA (0.9) y reason indicando que la reseña debe estar recién ` +
      `publicada hoy. Responde EXCLUSIVAMENTE con JSON: {"valid": boolean, "confidence": 0..1, "reason": "motivo breve en español"}.`;
    const PHOTO_SYS =
      `Eres un verificador de capturas de pantalla. La fecha de HOY es ${today}. Te paso una captura que DEBE ` +
      `ser una PUBLICACIÓN en una red social (Instagram, Facebook, TikTok, X/Twitter, Stories) con una FOTO y ` +
      `que ETIQUETA o MENCIONA al restaurante "${b.name}", publicada HOY en esta visita. Es válida SOLO si: ` +
      `(a) se ve que es una red social; (b) hay una foto/imagen; (c) aparece el nombre o etiqueta del ` +
      `restaurante "${b.name}" (un @, # o mención); y (d) la FECHA visible es RECIENTE, de HOY ("ahora", "hace ` +
      `un momento", "hace X minutos/horas", "hoy" o fecha igual a hoy). Si la publicación es de hace DÍAS, ` +
      `SEMANAS o MESES, NO es válida (no es de esta visita): valid:false con confidence ALTA (0.9) y reason ` +
      `indicando que debe ser una publicación recién hecha hoy. Sé tolerante con recortes. ` +
      `Responde EXCLUSIVAMENTE con JSON: {"valid": boolean, "confidence": 0..1, "reason": "motivo breve en español"}.`;
    const FOLLOW_SYS =
      `Eres un verificador de capturas de pantalla. Te paso una captura que DEBE demostrar que el usuario ` +
      `SIGUE la cuenta del restaurante "${b.name}" en una red social (Instagram, Facebook, TikTok, X). Es ` +
      `válida si se ve el perfil/cuenta del restaurante "${b.name}" con el estado de "Siguiendo"/"Following" ` +
      `activado. Sé tolerante con recortes y nombres parecidos, pero rechaza capturas que no muestren que se ` +
      `sigue a la cuenta o sean de otra cuenta. Responde EXCLUSIVAMENTE con JSON: ` +
      `{"valid": boolean, "confidence": 0..1, "reason": "motivo breve en español"}.`;
    const system = action === "review" ? REVIEW_SYS : action === "follow" ? FOLLOW_SYS : PHOTO_SYS;
    const userText =
      action === "review"
        ? "¿Es una reseña publicada de este restaurante?"
        : action === "follow"
          ? "¿Demuestra que el usuario sigue a la cuenta de este restaurante?"
          : "¿Es una publicación social que etiqueta a este restaurante?";
    const raw = await completeVision({
      workspaceId: "bubui-system",
      model: "claude-haiku-4-5-20251001",
      feature: "bubui-mesa-verify",
      maxTokens: 200,
      imageUrls: [shotUrl],
      system,
      userText
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      const conf = typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0;
      reason = typeof j.reason === "string" ? j.reason : "";
      if (j.valid === true && conf >= 0.6) {
        valid = true; // verificada con seguridad
      } else if (conf < 0.6) {
        // La IA NO está segura (ni claramente válida ni claramente inválida):
        // se acepta provisional y se marca para revisión del camarero.
        valid = true;
        provisional = true;
        reason = PROVISIONAL_MSG;
      } else {
        valid = false; // rechazo claro (no es reseña/publicación de este sitio)
      }
    } else {
      // La IA no devolvió un veredicto legible → provisional (no bloquear).
      valid = true;
      provisional = true;
      reason = PROVISIONAL_MSG;
    }
  } catch (e: any) {
    // IA no disponible: se acepta PROVISIONALMENTE para no bloquear a la mesa; se
    // marca para que el camarero la verifique (la captura queda guardada).
    valid = true;
    provisional = true;
    reason = PROVISIONAL_MSG;
  }

  // 3) Si es válida (o provisional), marca la acción verificada del comensal.
  if (valid) {
    const data: any = {};
    if (action === "review") {
      data.reviewVerified = true;
      data.reviewShotUrl = shotUrl;
      data.reviewProvisional = provisional;
    } else if (action === "follow") {
      data.followVerified = true;
      data.followShotUrl = shotUrl;
      data.followProvisional = provisional;
    } else {
      // "photo" → columnas social*
      data.socialVerified = true;
      data.socialShotUrl = shotUrl;
      data.socialProvisional = provisional;
    }
    if (!me.contributedAt) data.contributedAt = new Date();
    try {
      await prisma.bubuiTableParticipant.update({ where: { id: me.id }, data });
    } catch (e: any) {
      return NextResponse.json({ error: { code: "db_update_failed", message: `Guardar acción: ${e?.message ?? e}` } }, { status: 500 });
    }
  }

  let loaded;
  try {
    loaded = await loadTableState(session.id, ticketAmount);
  } catch (e: any) {
    return NextResponse.json({ error: { code: "state_failed", message: `Estado mesa: ${e?.message ?? e}` } }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    valid,
    provisional,
    reason: reason || (valid ? "Acción verificada." : "No hemos podido validar la captura. Inténtalo de nuevo."),
    state: loaded?.state ?? null
  });
}
