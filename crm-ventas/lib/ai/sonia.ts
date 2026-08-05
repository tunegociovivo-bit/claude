import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import {
  appointmentsOfDay,
  bookAppointment,
  cancelAppointmentByPhoneAndTime,
} from "@/lib/appointments";
import { normalizePhone } from "@/lib/phone";
import type { WorkspaceSettings } from "@/lib/settings";

// ---------------------------------------------------------------------------
// Herramientas de SONIA — compartidas entre el canal de voz (Vapi ejecuta el
// LLM y nos pide ejecutar la herramienta por webhook) y el canal de WhatsApp
// (nosotros ejecutamos el bucle con la API de Claude).
// ---------------------------------------------------------------------------

export const SONIA_TOOL_SCHEMAS = [
  {
    name: "consultar_disponibilidad",
    description:
      "Consulta las citas ya ocupadas de un día concreto para poder ofrecer huecos libres. Úsala SIEMPRE antes de proponer o confirmar una hora.",
    input_schema: {
      type: "object" as const,
      properties: {
        fecha: {
          type: "string",
          description: "Día a consultar en formato YYYY-MM-DD",
        },
      },
      required: ["fecha"],
    },
  },
  {
    name: "agendar_cita",
    description:
      "Crea una cita confirmada. Antes de llamarla debes tener: nombre del cliente, teléfono, y fecha y hora exactas confirmadas por el cliente. Nunca inventes datos.",
    input_schema: {
      type: "object" as const,
      properties: {
        nombre: { type: "string", description: "Nombre del cliente" },
        telefono: {
          type: "string",
          description: "Teléfono del cliente (con o sin prefijo)",
        },
        fecha_hora: {
          type: "string",
          description: "Fecha y hora de inicio en formato ISO, p.ej. 2026-08-10T17:00:00",
        },
        notas: {
          type: "string",
          description: "Motivo de la cita u observaciones (opcional)",
        },
      },
      required: ["nombre", "telefono", "fecha_hora"],
    },
  },
  {
    name: "cancelar_cita",
    description:
      "Cancela una cita existente identificada por el teléfono del cliente y la fecha y hora aproximada.",
    input_schema: {
      type: "object" as const,
      properties: {
        telefono: { type: "string", description: "Teléfono del cliente" },
        fecha_hora: { type: "string", description: "Fecha y hora de la cita en ISO" },
      },
      required: ["telefono", "fecha_hora"],
    },
  },
];

export async function executeSoniaTool(opts: {
  workspaceId: string;
  settings: WorkspaceSettings;
  name: string;
  input: any;
  channel: "whatsapp" | "llamada";
  callId?: string;
  // Teléfono del interlocutor (fallback si el cliente no dicta otro)
  callerPhone?: string | null;
}): Promise<string> {
  const { workspaceId, settings, name } = opts;
  const input = opts.input ?? {};
  try {
    if (name === "consultar_disponibilidad") {
      const fecha = String(input.fecha ?? "");
      const citas = await appointmentsOfDay(workspaceId, fecha);
      if (citas === null) return JSON.stringify({ error: "Fecha no válida, usa YYYY-MM-DD" });
      return JSON.stringify({
        fecha,
        horario_negocio: settings.sonia.openingHours,
        duracion_cita_min: settings.sonia.slotMinutes,
        ocupado: citas.map((c) => ({
          inicio: c.startsAt.toISOString(),
          duracion_min: c.durationMin,
        })),
      });
    }

    if (name === "agendar_cita") {
      const telefono =
        normalizePhone(String(input.telefono ?? ""), settings.whatsapp.countryCode) ||
        opts.callerPhone ||
        null;
      const result = await bookAppointment({
        workspaceId,
        customerName: String(input.nombre ?? "").trim() || "Sin nombre",
        customerPhone: telefono,
        datetimeISO: String(input.fecha_hora ?? ""),
        notes: input.notas ? String(input.notas) : undefined,
        source: opts.channel,
        callId: opts.callId,
      });
      if (!result.ok) {
        return JSON.stringify({
          error: result.error,
          ocupado: result.conflicts ?? [],
          instruccion:
            "NO digas que la cita está confirmada. Ofrece al cliente otro horario libre.",
        });
      }
      return JSON.stringify({
        ok: true,
        cita_confirmada: true,
        inicio: result.startsAt,
      });
    }

    if (name === "cancelar_cita") {
      const telefono =
        normalizePhone(String(input.telefono ?? ""), settings.whatsapp.countryCode) ||
        opts.callerPhone ||
        "";
      const result = await cancelAppointmentByPhoneAndTime({
        workspaceId,
        customerPhone: telefono,
        datetimeISO: String(input.fecha_hora ?? ""),
      });
      return JSON.stringify(result);
    }

    return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
  } catch (err: any) {
    return JSON.stringify({ error: `Error interno: ${err?.message ?? "desconocido"}` });
  }
}

// ---------------------------------------------------------------------------
// Prompt de sistema por cliente
// ---------------------------------------------------------------------------

export function buildSoniaSystemPrompt(
  settings: WorkspaceSettings,
  channel: "whatsapp" | "llamada"
): string {
  const s = settings.sonia;
  const now = new Date();
  const hoy = now.toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const canal =
    channel === "llamada"
      ? "Estás atendiendo una LLAMADA TELEFÓNICA. Habla de forma natural, frases cortas, sin listas ni formato. No deletrees salvo que te lo pidan."
      : "Estás atendiendo una conversación de WHATSAPP. Responde en mensajes breves y claros, sin markdown pesado.";

  return [
    `Eres Paula, la recepcionista virtual de ${s.businessName || "este negocio"}.`,
    canal,
    `Hoy es ${hoy}.`,
    "",
    "Tu trabajo:",
    "1. Dar información del negocio (usa solo la información de abajo, nunca inventes datos).",
    "2. Agendar, consultar o cancelar citas.",
    "",
    "Cómo agendar una cita:",
    "1) Averigua qué día quiere el cliente y usa consultar_disponibilidad para ver los huecos ocupados.",
    `2) Propón horas libres dentro del horario del negocio (${s.openingHours}).`,
    "3) Pide nombre y teléfono si no los tienes. Nunca inventes ninguno de los dos.",
    "4) Confirma en voz alta fecha, hora y nombre, y solo entonces llama a agendar_cita.",
    "5) Si agendar_cita devuelve error u ocupado, NO digas que está confirmada: ofrece otra hora.",
    "",
    `INFORMACIÓN DEL NEGOCIO:\n${s.businessInfo || "(sin información adicional)"}`,
    "",
    `HORARIO: ${s.openingHours}`,
    "",
    s.promptExtra ? `INSTRUCCIONES ESPECÍFICAS DE ESTE NEGOCIO:\n${s.promptExtra}` : "",
    "",
    "Si te preguntan algo que no sabes o que no está en la información del negocio, dilo con honestidad y ofrece tomar nota para que el equipo devuelva la llamada o el mensaje.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Agente de WhatsApp — bucle de herramientas con la API de Claude
// ---------------------------------------------------------------------------

const anthropic = new Anthropic();

export async function runSoniaWhatsappAgent(opts: {
  workspaceId: string;
  settings: WorkspaceSettings;
  phone: string; // teléfono normalizado o chatId
}): Promise<string | null> {
  const { workspaceId, settings, phone } = opts;

  // Historial reciente del hilo (el último mensaje "in" es el que respondemos)
  const history = await prisma.message.findMany({
    where: { workspaceId, phone },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  history.reverse();
  if (history.length === 0) return null;

  const messages: Anthropic.MessageParam[] = [];
  for (const m of history) {
    const role = m.direction === "in" ? "user" : "assistant";
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role && typeof prev.content === "string") {
      prev.content = `${prev.content}\n${m.body}`;
    } else {
      messages.push({ role, content: m.body });
    }
  }
  if (messages.length === 0 || messages[0].role !== "user") {
    messages.unshift({ role: "user", content: "Hola" });
  }
  if (messages[messages.length - 1].role !== "user") return null;

  const system = buildSoniaSystemPrompt(settings, "whatsapp");
  const model = process.env.SONIA_MODEL || "claude-opus-5";

  let response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system,
    tools: SONIA_TOOL_SCHEMAS,
    messages,
  });

  // Bucle agéntico manual con tope de iteraciones
  for (let i = 0; i < 6 && response.stop_reason === "tool_use"; i++) {
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await executeSoniaTool({
        workspaceId,
        settings,
        name: tu.name,
        input: tu.input,
        channel: "whatsapp",
        callerPhone: phone.includes("@") ? null : phone,
      });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    messages.push({ role: "user", content: results });

    response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system,
      tools: SONIA_TOOL_SCHEMAS,
      messages,
    });
  }

  if (response.stop_reason === "refusal") return null;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return text || null;
}
