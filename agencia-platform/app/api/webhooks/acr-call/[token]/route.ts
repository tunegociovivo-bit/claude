/**
 * POST /api/webhooks/acr-call/[token]
 *
 * Recibe el WebHook de ACR Phone (móvil) cuando se graba una llamada:
 * un POST multipart/form-data con el AUDIO + fecha + duración + notas
 * (+ "secret" opcional). El Hub:
 *   1. Valida el token (URL) — mismo que settings.aiAgent.inbound.call.webhookToken.
 *   2. Transcribe el audio con Whisper.
 *   3. Saca teléfono/dirección/nombre del NOMBRE del archivo de ACR.
 *   4. Dispara a Sonia (CALL_INBOUND) → tarea en el proyecto/columna
 *      configurados (NEGOCIO VIVO GENERAL → REUNIONES Y LLAMADAS) + aviso de voz.
 *
 * Así las llamadas entran al instante, sin pasar por Make ni por el email.
 *
 * Auth: el middleware deja pasar /api/webhooks/*; aquí validamos el token
 * de la URL y, si está configurado, el campo "secret".
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { triggerNvIaFromInbound } from "@/lib/ai/nv-ia/inbound-trigger";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Extrae metadatos del nombre que pone ACR Phone, p.ej.:
 *   "2026-05-24 11-16-26 (phone) CRISTINA JIMENEZ (+34 616 36 28 64) ↙.m4a"
 */
function parseAcrFilename(name: string) {
  const out: { date?: string; time?: string; type?: string; contact?: string; phone?: string; direction?: string } = {};
  const dt = name.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})/);
  if (dt) {
    out.date = `${dt[1].split("-").reverse().join("/")}`;
    out.time = `${dt[2]}:${dt[3]}`;
  }
  const typ = name.match(/\((phone|mic|[^)]*whatsapp[^)]*)\)/i);
  if (typ) out.type = typ[1].toLowerCase();
  // Teléfono entre paréntesis: (+34 616 36 28 64) o (34616362864)
  const phone = name.match(/\(\s*(\+?\d[\d\s().-]{6,})\)/);
  if (phone) out.phone = phone[1].replace(/[^\d+]/g, "");
  if (name.includes("↙")) out.direction = "Entrante";
  else if (name.includes("↗")) out.direction = "Saliente";
  // Nombre del contacto: lo que va tras "(phone) " y antes del "(+34...":
  const m = name.match(/\((?:phone|mic)\)\s*(.+?)\s*\(\+?\d/i);
  if (m) out.contact = m[1].trim();
  return out;
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = String(params.token ?? "").trim();
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  const wsAll = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  const ws = wsAll.find((w) => (w.settings as any)?.aiAgent?.inbound?.call?.webhookToken === token);
  if (!ws) return NextResponse.json({ ok: false, error: "token not found" }, { status: 404 });

  const cfgCall = (ws.settings as any)?.aiAgent?.inbound?.call ?? {};

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }

  // Secret opcional (campo "secret" de ACR).
  if (cfgCall.secret) {
    const got = form.get("secret");
    if (typeof got !== "string" || got !== cfgCall.secret) {
      return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
    }
  }

  // Buscar el audio: en el runtime de Node los ficheros de formData llegan
  // como Blob/File (tienen arrayBuffer()). Recogemos también los nombres de
  // campo y un posible teléfono/nombre en campos de texto, para diagnóstico.
  let audio: Blob | null = null;
  let audioName = "";
  const fieldNames: string[] = [];
  const textFields: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    fieldNames.push(k);
    if (typeof v === "string") {
      textFields[k] = v;
    } else if (v && typeof (v as any).arrayBuffer === "function" && (v as any).size > 0) {
      audio = v as Blob;
      audioName = String((v as any).name ?? "");
    }
  }
  const dateField = String(form.get("date") ?? "").trim();
  const durationField = String(form.get("duration") ?? "").trim();
  const notesField = String(form.get("notes") ?? "").trim();
  const filename = audioName;
  const meta = parseAcrFilename(filename);

  // Ping / prueba de conexión de ACR: manda solo "source"/"secret" sin audio.
  // Respondemos 200 para que el test salga en verde; no hay nada que procesar.
  if (!audio) {
    return NextResponse.json({ ok: true, ping: true, received: fieldNames });
  }

  // Transcribir con Whisper.
  let transcript = "";
  let transcribeError = "";
  if (audio) {
    try {
      transcript = await transcribeAudioWithWhisper({
        workspaceId: ws.id,
        audio,
        filename: filename || "call.m4a",
        language: "es"
      });
    } catch (e: any) {
      transcribeError = String(e?.message ?? e).slice(0, 200);
    }
  }

  let from = meta.phone ?? "";
  // Fallback: buscar un teléfono en cualquier campo de texto (por si ACR
  // manda el número aparte y el archivo no trae nombre descriptivo).
  if (!from) {
    for (const val of Object.values(textFields)) {
      const m = String(val).match(/\+?\d[\d\s().-]{7,}/);
      if (m) {
        from = m[0].replace(/[^\d+]/g, "");
        break;
      }
    }
  }

  if (!from && !transcript) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing phone/transcript",
        debug: {
          fields: fieldNames,
          textFields,
          fileFound: !!audio,
          filename,
          audioBytes: audio ? (audio as any).size : 0,
          transcribeError
        }
      },
      { status: 400 }
    );
  }

  // Asociar a cliente por teléfono (últimos 9 dígitos).
  let clientId: string | null = null;
  try {
    const digits = from.replace(/\D/g, "");
    if (digits.length >= 9) {
      const c = await prisma.client.findFirst({
        where: { workspaceId: ws.id, phone: { contains: digits.slice(-9), mode: "insensitive" } },
        select: { id: true }
      });
      if (c) clientId = c.id;
    }
  } catch {}

  const dirArrow = meta.direction === "Saliente" ? "↗" : "↙";
  const title =
    `📞 ${meta.contact || from || "Llamada"} · ${dirArrow}` +
    (meta.date ? ` · ${meta.date}${meta.time ? " " + meta.time : ""}` : "");

  const r = await triggerNvIaFromInbound({
    workspaceId: ws.id,
    externalId: filename || `acr-${Date.now()}`,
    trigger: "CALL_INBOUND",
    taskTitle: title,
    body:
      `Transcripción de la llamada:\n\n${(transcript || "[Sin transcripción]").slice(0, 14000)}\n\n` +
      `---\n` +
      (meta.date ? `Fecha: ${meta.date} ${meta.time ?? ""}\n` : dateField ? `Fecha: ${dateField}\n` : "") +
      (durationField ? `Duración: ${durationField}\n` : "") +
      (meta.direction ? `Dirección: ${meta.direction}\n` : "") +
      (notesField ? `Notas: ${notesField}\n` : ""),
    metadata: {
      from,
      direction: meta.direction ?? "",
      contact: meta.contact ?? "",
      date: meta.date ?? dateField,
      duration: durationField,
      filename
    },
    clientId
  });

  if (!r) {
    return NextResponse.json({
      ok: true,
      processed: false,
      reason: "nv_ia_inbound_disabled_or_not_configured"
    });
  }
  return NextResponse.json({ ok: true, processed: true, taskId: r.taskId, runId: r.runId });
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  return NextResponse.json({
    ok: true,
    endpoint: "acr-call",
    tokenValid: String(params.token ?? "").length >= 16,
    expects: "multipart/form-data con el audio + (date, duration, notes, secret opcional)"
  });
}
