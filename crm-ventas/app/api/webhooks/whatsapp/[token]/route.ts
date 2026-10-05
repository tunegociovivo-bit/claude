import { NextRequest, NextResponse } from "next/server";
import { findWorkspaceByToken } from "@/lib/settings";
import { ingestWhatsappEvent } from "@/lib/inbox/ingest";
import { kickInboxWorker } from "@/lib/inbox/worker";
import { AUTO_DEBOUNCE_MS } from "@/lib/inbox/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Webhook de WAHA (WhatsApp) — un único token por negocio para TODOS sus
// números: la sesión del evento identifica el número (línea).
//   URL:     https://<crm>/api/webhooks/whatsapp/<token>
//   Eventos: message, message.any, message.ack
// El procesamiento vive en lib/inbox/ingest.ts; las respuestas salen por la
// cola anti-baneo (lib/inbox/outbound.ts), no desde esta petición.
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ws = await findWorkspaceByToken("whatsapp", params.token);
  if (!ws) return NextResponse.json({ error: "Token no válido" }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON no válido" }, { status: 400 });
  }

  try {
    const result = await ingestWhatsappEvent(ws, body);
    if (result.kick) kickInboxWorker(AUTO_DEBOUNCE_MS + 300);
    const { kick: _kick, ...response } = result;
    return NextResponse.json(response);
  } catch (error: any) {
    // 503 → WAHA reintenta; la deduplicación por id evita registros dobles.
    console.error("[whatsapp-webhook] error procesando evento:", error?.message);
    return NextResponse.json(
      { error: "No se pudo procesar el evento; reintentar" },
      { status: 503, headers: { "Retry-After": "3" } }
    );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ws = await findWorkspaceByToken("whatsapp", params.token);
  if (!ws) return NextResponse.json({ error: "Token no válido" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    uso: "Configura esta URL como webhook en WAHA con eventos message, message.any y message.ack",
  });
}
