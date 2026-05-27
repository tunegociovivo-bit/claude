/**
 * POST /api/webhooks/inbound-email/[token]
 *
 * Endpoint genérico para recibir EMAILS ENTRANTES desde cualquier
 * servicio: Resend Inbound, ImprovMX, Postmark, SendGrid Inbound
 * Parse, o un Zapier hook redirigiendo IMAP. Solo exigimos que el
 * payload incluya from/to/subject + (text o html).
 *
 * Identifica el workspace por el token: cada workspace puede activar
 * inbound en /admin/nv-ia, genera un token aleatorio y configura el
 * proveedor de email para que POSTea aquí. Si el token no coincide
 * con ningún workspace → 404.
 *
 * Crea una task en el proyecto buzón de Sonia con el contenido del
 * email y dispara un AiAgentRun(EMAIL_INBOUND). La IA luego decide:
 *   - Si es una pregunta concreta → draft_email de respuesta
 *   - Si es info útil sin pregunta → add_comment archivando
 *   - Si es spam/auto-reply → add_comment marcando + status DONE
 *
 * Auth: token único en URL (NO HMAC porque cada proveedor firma
 * distinto y queremos máxima compatibilidad). El token es secreto
 * y suficiente — si se filtra, basta regenerarlo en /admin/nv-ia.
 *
 * Acepta varios shapes de body:
 *   - Resend Inbound: { from, to, subject, html, text, headers, messageId }
 *   - ImprovMX: { from, to, subject, body-plain, body-html }
 *   - Genérico: { from, to, subject, text, html, messageId }
 *
 * Devuelve 200 SIEMPRE (excepto auth fail) para que el proveedor
 * no haga retry si fue duplicado o filtrado por nuestra lógica.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { triggerNvIaFromInbound } from "@/lib/ai/nv-ia/inbound-trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  // Auth: buscar workspace cuyo settings.aiAgent.inbound.email.webhookToken
  // sea el token de la URL. Es lineal (LIKE-style sobre JSON) — para
  // un usuario con miles de workspaces necesitaría índice, pero en
  // nuestro escenario (decenas máximo) es trivial.
  const token = String(params.token ?? "").trim();
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  // Buscamos en TODOS los workspaces el primero que tenga este token.
  // No podemos usar where: { settings: { path:..., equals:... } }
  // porque el path es anidado y Prisma JSON queries varían por driver.
  // Cargamos todos y filtramos en memoria — los workspaces son pocos.
  const wsAll = await prisma.workspace.findMany({
    select: { id: true, settings: true }
  });
  const ws = wsAll.find((w) => {
    const t = (w.settings as any)?.aiAgent?.inbound?.email?.webhookToken;
    return t === token;
  });
  if (!ws) {
    return NextResponse.json({ ok: false, error: "token not found" }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Normalizar shape — buscamos en varios nombres de campo según proveedor.
  const from = String(body.from ?? body.From ?? body.sender ?? "").trim();
  const to = String(body.to ?? body.To ?? body.recipient ?? "").trim();
  const subject = String(body.subject ?? body.Subject ?? "").trim();
  const html = String(body.html ?? body["body-html"] ?? body.Html ?? "").trim();
  const text = String(
    body.text ?? body["body-plain"] ?? body.Text ?? stripHtml(html)
  ).trim();
  const messageId = String(
    body.messageId ?? body["Message-Id"] ?? body.headers?.["message-id"] ?? `inbound-${Date.now()}`
  ).trim();

  if (!from || !text) {
    return NextResponse.json({ ok: false, error: "missing from/text" }, { status: 400 });
  }

  // Intentamos asociar a un cliente conocido si el `from` coincide
  // con email de un Client del workspace (case-insensitive).
  let clientId: string | null = null;
  try {
    const emailMatch = from.match(/[\w.+-]+@[\w.-]+/);
    if (emailMatch) {
      const c = await prisma.client.findFirst({
        where: {
          workspaceId: ws.id,
          email: { equals: emailMatch[0], mode: "insensitive" }
        },
        select: { id: true }
      });
      if (c) clientId = c.id;
    }
  } catch {}

  const r = await triggerNvIaFromInbound({
    workspaceId: ws.id,
    externalId: messageId,
    trigger: "EMAIL_INBOUND",
    taskTitle: `📧 Email de ${from.slice(0, 80)}: ${subject.slice(0, 100) || "(sin asunto)"}`,
    body: text.slice(0, 16000),
    metadata: { from, to, subject, messageId },
    clientId
  });

  if (!r) {
    // Sonia no configurada o inbound desactivado — devolvemos 200
    // para que el proveedor no reintente. Logueamos para visibilidad.
    return NextResponse.json({
      ok: true,
      processed: false,
      reason: "nv_ia_inbound_disabled_or_not_configured"
    });
  }

  return NextResponse.json({
    ok: true,
    processed: true,
    taskId: r.taskId,
    runId: r.runId
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// GET para healthcheck — algunos proveedores hacen GET para validar la URL.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = String(params.token ?? "").trim();
  return NextResponse.json({ ok: true, endpoint: "inbound-email", tokenValid: token.length >= 16 });
}
