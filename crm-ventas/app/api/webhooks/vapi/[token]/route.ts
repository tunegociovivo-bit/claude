import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findOrCreateContactByPhone } from "@/lib/contacts";
import { normalizePhone } from "@/lib/phone";
import {
  buildSoniaSystemPrompt,
  executeSoniaTool,
  SONIA_TOOL_SCHEMAS,
} from "@/lib/ai/sonia";
import {
  findWorkspaceByToken,
  publicBaseUrl,
  type WorkspaceSettings,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Webhook de Vapi para llamadas ENTRANTES.
//
// En Vapi se configura el número de teléfono del cliente con este Server URL
// (sin asistente fijo). Vapi envía:
//  - assistant-request  → devolvemos el asistente transitorio construido con el
//                         prompt específico del cliente guardado en el CRM.
//  - tool-calls         → ejecutamos las herramientas (disponibilidad, agendar,
//                         cancelar) y devolvemos los resultados.
//  - status-update      → estado de la llamada.
//  - end-of-call-report → guardamos transcripción, resumen y grabación.
// ---------------------------------------------------------------------------

function vapiTools(baseUrl: string, token: string) {
  return SONIA_TOOL_SCHEMAS.map((t) => ({
    type: "function",
    async: false,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
    server: { url: `${baseUrl}/api/webhooks/vapi/${token}` },
  }));
}

function buildAssistant(settings: WorkspaceSettings, token: string) {
  const s = settings.sonia;
  const baseUrl = publicBaseUrl();
  return {
    name: `Paula — ${s.businessName || "recepción"}`,
    firstMessage: s.firstMessage,
    model: {
      provider: s.vapiModelProvider,
      model: s.vapiModel,
      messages: [
        { role: "system", content: buildSoniaSystemPrompt(settings, "llamada") },
      ],
      tools: vapiTools(baseUrl, token),
    },
    // Voz V2 con detección automática: puede reproducir la respuesta de Paula
    // en los cinco idiomas sin quedar fijada al locale español de Azure.
    voice: { provider: "vapi", voiceId: "Layla", version: 2, language: "auto" },
    transcriber: { provider: "deepgram", model: "nova-3", language: "multi" },
    analysisPlan: {
      summaryPlan: {
        enabled: true,
        messages: [
          {
            role: "system",
            content:
              "Resume la llamada en español, aunque la conversación haya sido en otro idioma. Escribe un párrafo breve y útil para el equipo del negocio, indicando qué necesitaba el cliente y el resultado de la llamada.",
          },
        ],
      },
    },
    artifactPlan: { recordingEnabled: true },
    server: { url: `${baseUrl}/api/webhooks/vapi/${token}` },
  };
}

async function upsertCall(workspaceId: string, call: any) {
  const providerCallId: string | undefined = call?.id;
  if (!providerCallId) return null;
  const fromNumber = call?.customer?.number ?? call?.from ?? null;
  const toNumber = call?.phoneNumber?.number ?? call?.to ?? null;
  const existing = await prisma.call.findFirst({ where: { providerCallId } });
  if (existing) return existing;
  return prisma.call.create({
    data: {
      workspaceId,
      providerCallId,
      fromNumber,
      toNumber,
      status: "en-curso",
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ws = await findWorkspaceByToken("vapi", params.token);
  if (!ws) return NextResponse.json({ error: "Token no válido" }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON no válido" }, { status: 400 });
  }

  const message = body?.message ?? {};
  const type: string = message?.type ?? "";
  const call = message?.call ?? {};

  // 1) Vapi pide el asistente para una llamada entrante
  if (type === "assistant-request") {
    await upsertCall(ws.id, call);
    return NextResponse.json({ assistant: buildAssistant(ws.settings, params.token) });
  }

  // 2) Vapi pide ejecutar herramientas durante la llamada
  if (type === "tool-calls") {
    const rawCalls: any[] =
      message?.toolCallList ?? message?.toolCalls ?? message?.toolWithToolCallList ?? [];
    const callerPhone = normalizePhone(
      String(call?.customer?.number ?? ""),
      ws.settings.whatsapp.countryCode
    );
    const dbCall = await upsertCall(ws.id, call);

    const results = [];
    for (const tc of rawCalls) {
      const id = tc?.id ?? tc?.toolCall?.id;
      const fn = tc?.function ?? tc?.toolCall?.function ?? {};
      const name = fn?.name ?? tc?.name ?? "";
      let args = fn?.arguments ?? tc?.arguments ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      const result = await executeSoniaTool({
        workspaceId: ws.id,
        settings: ws.settings,
        name,
        input: args,
        channel: "llamada",
        callId: dbCall?.id,
        callerPhone,
      });
      results.push({ toolCallId: id, result });
    }
    return NextResponse.json({ results });
  }

  // 3) Estado de la llamada
  if (type === "status-update") {
    const providerCallId = call?.id;
    const status = message?.status;
    if (providerCallId && status) {
      await prisma.call.updateMany({
        where: { providerCallId },
        data: {
          status:
            status === "ended" ? "finalizada" : status === "in-progress" ? "en-curso" : status,
        },
      });
    }
    return NextResponse.json({ ok: true });
  }

  // 4) Informe final: transcripción, resumen, grabación
  if (type === "end-of-call-report") {
    const providerCallId = call?.id;
    const transcript =
      message?.artifact?.transcript ?? message?.transcript ?? null;
    const summary = message?.analysis?.summary ?? message?.summary ?? null;
    const recordingCandidates = [
      message?.artifact?.recording,
      message?.artifact?.recordingUrl,
      message?.recordingUrl,
    ];
    const recordingUrl =
      recordingCandidates.find((value): value is string => typeof value === "string") ?? null;
    const endedReason = message?.endedReason ?? null;
    const durationSec = Math.round(
      Number(message?.durationSeconds ?? message?.call?.duration ?? 0)
    );

    const fromRaw = call?.customer?.number ?? "";
    const phone = normalizePhone(String(fromRaw), ws.settings.whatsapp.countryCode);

    let contactId: string | undefined;
    if (phone) {
      const contact = await findOrCreateContactByPhone({
        workspaceId: ws.id,
        phone,
        source: "llamada",
      });
      contactId = contact.id;
    }

    const failed = /(no-answer|busy|failed|error)/i.test(String(endedReason ?? ""));
    const data = {
      status: failed ? "fallida" : "finalizada",
      endedReason,
      durationSec: durationSec || null,
      transcript,
      summary,
      recordingUrl,
      contactId,
    };

    if (providerCallId) {
      await prisma.call.updateMany({
        where: { providerCallId },
        data,
      });
    }
    return NextResponse.json({ ok: true });
  }

  // Otros eventos (speech-update, transcript, hang…) se aceptan sin acción.
  return NextResponse.json({ ok: true });
}

// GET autodocumentado: útil para verificar el token al configurar Vapi.
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ws = await findWorkspaceByToken("vapi", params.token);
  if (!ws) return NextResponse.json({ error: "Token no válido" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    uso: "Configura esta URL como Server URL del número de teléfono en Vapi (inbound).",
    eventos: ["assistant-request", "tool-calls", "status-update", "end-of-call-report"],
  });
}
