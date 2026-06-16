/**
 * POST /api/bubui/scan/read-ticket   (multipart/form-data)
 *
 * El cliente sube la foto de un ticket de compra; la IA (visión) lee el
 * importe TOTAL pagado y lo devuelve para autocompletar el campo "¿Cuánto
 * has pagado?" del escaneo. La imagen se guarda en storage para que el
 * cliente pueda consultarla luego (devolvemos su URL).
 *
 * Body: campo "file" (imagen) + opcional "customerId".
 *
 * Respuesta: { amount: number|null, currency, ticketUrl|null, confidence }
 *
 * Degradación: si no hay storage o IA configurada, responde 503 con un
 * código claro y la app cae al modo manual (teclear el importe).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isStorageEnabled, uploadBuffer, signedDownloadUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

export async function POST(req: Request) {
  if (!isStorageEnabled()) {
    return NextResponse.json(
      { error: { code: "storage_disabled", message: "Storage no configurado; usa el importe manual." } },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  // customerId por QUERY (los campos de texto del multipart se pierden a veces en
  // RN/Android); fallback al form y, por último, "anon".
  const customerId =
    url.searchParams.get("customerId") ||
    (typeof form?.get("customerId") === "string" ? (form!.get("customerId") as string) : "anon");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: { code: "no_file", message: "Falta el campo 'file'." } }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: { code: "empty", message: "Archivo vacío." } }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: { code: "too_large", message: `La imagen supera 10 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).` } },
      { status: 413 }
    );
  }
  const mimeType = file.type || "image/jpeg";
  if (!ALLOWED.includes(mimeType)) {
    return NextResponse.json(
      { error: { code: "bad_type", message: "Formato no soportado. Usa una foto JPG/PNG." } },
      { status: 415 }
    );
  }

  // 1) Guardar el ticket en storage (lo necesita la IA y el historial del cliente).
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const safeCustomer = customerId.replace(/[^\w-]+/g, "").slice(0, 40) || "anon";
  const s3Key = `bubui/tickets/${safeCustomer}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    await uploadBuffer({ s3Key, body: buf, contentType: mimeType });
  } catch (e: any) {
    return NextResponse.json(
      { error: { code: "upload_failed", message: `No se pudo guardar el ticket: ${e?.message ?? e}` } },
      { status: 502 }
    );
  }
  // URL para que la IA descargue la imagen y para devolvérsela al cliente.
  const ticketUrl = await signedDownloadUrl(s3Key, 60 * 60 * 24 * 30); // 30 días

  // 2) Pedir a la IA el total del ticket.
  let amount: number | null = null;
  let currency = "EUR";
  let confidence = 0;
  try {
    const { completeVision } = await import("@/lib/ai/anthropic");
    const raw = await completeVision({
      workspaceId: "bubui-system",
      model: "claude-haiku-4-5-20251001",
      feature: "bubui-ticket-ocr",
      maxTokens: 300,
      imageUrls: [ticketUrl],
      system:
        "Eres un lector de tickets de compra. Extrae SOLO el importe TOTAL final pagado " +
        "(el gran total, ya con impuestos, no subtotales ni el cambio). Responde EXCLUSIVAMENTE " +
        'con un JSON válido: {"amount": number, "currency": "EUR"|"USD"|..., "confidence": 0..1}. ' +
        'Si no puedes leer el total con seguridad, responde {"amount": null, "confidence": 0}. ' +
        "No añadas texto fuera del JSON.",
      userText: "¿Cuál es el importe TOTAL pagado en este ticket?"
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      if (typeof j.amount === "number" && isFinite(j.amount) && j.amount > 0 && j.amount <= 10000) {
        amount = Math.round(j.amount * 100) / 100;
      }
      if (typeof j.currency === "string") currency = j.currency;
      if (typeof j.confidence === "number") confidence = Math.max(0, Math.min(1, j.confidence));
    }
  } catch {
    // La IA falló: devolvemos el ticket guardado igualmente, sin importe.
  }

  // Persistimos el resultado del OCR ligado a la imagen. El scan usará ESTE
  // importe (no el que teclee el cliente) cuando el negocio exija ticket, y
  // marcará el registro como usado (un ticket = una compra).
  let ticketScanId: string | null = null;
  try {
    const row = await prisma.bubuiTicketScan.create({
      data: {
        customerId: safeCustomer === "anon" ? "anon" : customerId,
        amount,
        currency,
        confidence,
        ticketUrl
      },
      select: { id: true }
    });
    ticketScanId = row.id;
  } catch (e: any) {
    console.warn("[bubui read-ticket persist]", e?.message ?? e);
  }

  return NextResponse.json({ amount, currency, confidence, ticketUrl, ticketScanId });
}
