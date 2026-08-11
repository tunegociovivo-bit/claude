import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import {
  appointmentsOfDay,
  availableSlotsOfDay,
  bookAppointment,
  cancelAppointmentByPhoneAndTime,
  parseAppointmentDateTime,
} from "@/lib/appointments";
import { normalizePhone } from "@/lib/phone";
import type { WorkspaceSettings } from "@/lib/settings";
import { composeAgentPrompt } from "@/lib/admin/usage";
import { getGlobalPrompt } from "@/lib/admin/config";

// ---------------------------------------------------------------------------
// Herramientas de SONIA — compartidas entre el canal de voz (Vapi ejecuta el
// LLM y nos pide ejecutar la herramienta por webhook) y el canal de WhatsApp
// (nosotros ejecutamos el bucle con la API de Claude).
// ---------------------------------------------------------------------------

export const SONIA_TOOL_SCHEMAS = [
  {
    name: "consultar_disponibilidad",
    description:
      "Calcula los huecos en los que cabe completa una cita de la duración solicitada. Úsala SIEMPRE antes de proponer o confirmar una hora y ofrece sólo valores de huecos_libres.",
    input_schema: {
      type: "object" as const,
      properties: {
        fecha: {
          type: "string",
          description: "Día a consultar en formato YYYY-MM-DD",
        },
        duracion_min: {
          type: "integer",
          minimum: 15,
          maximum: 240,
          description: "Duración total solicitada por el cliente, en minutos",
        },
        despues_de: {
          type: "string",
          description:
            "Opcional. Hora HH:mm a partir de la que buscar más alternativas cuando el cliente rechaza las primeras.",
        },
      },
      required: ["fecha", "duracion_min"],
    },
  },
  {
    name: "agendar_cita",
    description:
      "Crea una cita confirmada. Llámala una sola vez y únicamente cuando tengas tratamiento, duración, nombre, teléfono y una fecha y hora elegida de huecos_libres. Nunca inventes datos.",
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
        duracion_min: {
          type: "integer",
          minimum: 15,
          maximum: 240,
          description: "Duración total confirmada por el cliente, en minutos",
        },
        notas: {
          type: "string",
          description: "Tratamiento solicitado y cualquier observación relevante",
        },
      },
      required: ["nombre", "telefono", "fecha_hora", "duracion_min", "notas"],
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

export function businessClock(now = new Date()) {
  const dateParts = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  const todayISO = dateParts(now);
  const tomorrowSeed = new Date(`${todayISO}T12:00:00Z`);
  tomorrowSeed.setUTCDate(tomorrowSeed.getUTCDate() + 1);
  const tomorrowISO = tomorrowSeed.toISOString().slice(0, 10);
  const label = (iso: string) =>
    new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`));
  const currentTime = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return {
    todayISO,
    tomorrowISO,
    todayLabel: label(todayISO),
    tomorrowLabel: label(tomorrowISO),
    currentTime,
  };
}

export function effectiveOpeningHours(settings: WorkspaceSettings): string {
  const info = settings.sonia.businessInfo ?? "";
  const match = info.match(
    /horario\s*:\s*([^:\r\n]{0,100}?\d{1,2}:\d{2}\s*(?:a|[-–])\s*\d{1,2}:\d{2})/i
  );
  return match?.[1]?.trim() || settings.sonia.openingHours;
}

export function voiceFirstMessage(settings: WorkspaceSettings): string {
  let message = settings.sonia.firstMessage.trim().replace(/\b([\p{L}]+)(\s+\1)\b/giu, "$1");
  if (/aruksa/i.test(settings.sonia.websiteUrl || "")) {
    message = message.replace(/aruxa/gi, "Aruksa");
  }
  return message;
}

export function selectAvailableSlots(available: string[], after?: string, now = new Date()) {
  const match = String(after ?? "").match(/^(\d{2}):(\d{2})$/);
  const minTime = match ? Number(match[1]) * 60 + Number(match[2]) : null;
  const todayISO = businessClock(now).todayISO;
  const filtered = available.filter((slot) => {
    if (slot.slice(0, 10) === todayISO && parseAppointmentDateTime(slot).getTime() <= now.getTime()) {
      return false;
    }
    if (minTime === null) return true;
    const time = slot.match(/T(\d{2}):(\d{2})/);
    return Boolean(time && Number(time[1]) * 60 + Number(time[2]) > minTime);
  });
  return { suggested: filtered.slice(0, 3), hasMore: filtered.length > 3 };
}

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
      const durationMin = Number(input.duracion_min);
      if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 240) {
        return JSON.stringify({ error: "Indica una duración válida entre 15 y 240 minutos" });
      }
      const citas = await appointmentsOfDay(workspaceId, fecha);
      if (citas === null) return JSON.stringify({ error: "Fecha no válida, usa YYYY-MM-DD" });
      const available = await availableSlotsOfDay({
        workspaceId,
        dateISO: fecha,
        durationMin,
        openingHours: effectiveOpeningHours(settings),
      });
      const { suggested, hasMore } = selectAvailableSlots(available ?? [], input.despues_de);
      const clock = businessClock();
      const fechaLegible = new Intl.DateTimeFormat("es-ES", {
        timeZone: "Europe/Madrid",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(`${fecha}T12:00:00Z`));
      return JSON.stringify({
        fecha,
        fecha_legible: fechaLegible,
        hora_actual_madrid: clock.currentTime,
        horario_negocio: effectiveOpeningHours(settings),
        duracion_solicitada_min: durationMin,
        huecos_libres: suggested,
        hay_mas_huecos: hasMore,
        instruccion:
          "Ofrece como máximo estas tres horas. Si ninguna sirve, vuelve a consultar indicando despues_de con la última hora ofrecida.",
        ocupado: citas.map((c: { startsAt: Date; durationMin: number }) => ({
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
        durationMin: Number(input.duracion_min),
        notes: input.notas ? String(input.notas) : undefined,
        source: opts.channel,
        callId: opts.callId,
        openingHours: effectiveOpeningHours(settings),
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
    console.error("[sonia-tool] fallo", {
      workspaceId,
      name,
      error: err instanceof Error ? err.message : String(err),
    });
    return JSON.stringify({
      error: "No se pudo completar la operación por un problema técnico del servidor",
      instruccion: "No confirmes la cita. Ofrece que el equipo contacte al cliente.",
    });
  }
}

// ---------------------------------------------------------------------------
// Prompt de sistema por cliente
// ---------------------------------------------------------------------------

export function buildSoniaSystemPrompt(
  settings: WorkspaceSettings,
  channel: "whatsapp" | "llamada",
  globalPrompt = "",
  now = new Date()
): string {
  const s = settings.sonia;
  const clock = businessClock(now);
  const openingHours = effectiveOpeningHours(settings);
  const canal =
    channel === "llamada"
      ? "Estás atendiendo una LLAMADA TELEFÓNICA. Habla de forma natural, con frases cortas, sin listas ni formato. No deletrees salvo que te lo pidan. Responde en español por defecto. Detecta el idioma de la persona y contesta siempre en ese mismo idioma si es español, inglés, francés, alemán o italiano. Si te pide expresamente uno de esos idiomas, cambia inmediatamente y mantén ese idioma hasta que solicite otro. Nunca digas que solo puedes hablar español. Para evitar errores de pronunciación, no uses la palabra «genial»: usa «perfecto» o «de acuerdo»."
      : "Estás atendiendo una conversación de WHATSAPP. Responde siempre al último mensaje en uno o dos párrafos breves y claros, sin markdown pesado.";

  return [
    `Eres ${s.agentName}, la recepcionista virtual de ${s.businessName || "este negocio"}.`,
    canal,
    `FECHA Y HORA OFICIAL DEL NEGOCIO (Europe/Madrid): hoy es ${clock.todayLabel} (${clock.todayISO}) y son las ${clock.currentTime}. Mañana es ${clock.tomorrowLabel} (${clock.tomorrowISO}). Usa siempre estos datos y nunca deduzcas la fecha desde tu conocimiento interno.`,
    "",
    "Tu trabajo:",
    "1. Dar información del negocio (usa solo la información de abajo, nunca inventes datos).",
    "2. Agendar, consultar o cancelar citas.",
    "3. Informar de promociones, descuentos, bonos, packs y sus enlaces exactos cuando aparezcan en la información del negocio.",
    "No eres una asistente de cultura general. Rechaza de forma breve preguntas ajenas al negocio (por ejemplo, capitales, noticias, matemáticas o curiosidades) y reconduce la conversación a los servicios del negocio.",
    "",
    "Cómo agendar una cita:",
    "1) Antes de consultar o prometer una hora, averigua el tratamiento y su duración total. Si hay opciones (por ejemplo 60 o 90 minutos), pregunta cuál quiere.",
    "2) Usa consultar_disponibilidad con la fecha y la duración. Ofrece EXCLUSIVAMENTE horas incluidas en huecos_libres; nunca calcules ni inventes horas por tu cuenta. Antes de enumerar horas, di siempre el día de la semana y la fecha completa devueltos por la herramienta. Ofrece un máximo de tres opciones por turno. Si no le sirven, consulta los siguientes huecos usando despues_de. Nunca ofrezcas una hora que ya haya pasado.",
    "3) Pide nombre y teléfono si no los tienes. Nunca inventes ninguno de los dos. En llamada, pide el teléfono dígito a dígito y, al confirmarlo, pronuncia las nueve cifras una por una, con una pausa breve entre ellas. Ejemplo: 680167881 se confirma «seis, ocho, cero, uno, seis, siete, ocho, ocho, uno»; nunca digas «dieciséis», «ochenta» ni leas el teléfono como una cantidad.",
    "4) Cuando el cliente elija una hora libre y ya tengas tratamiento, duración, nombre y teléfono, llama UNA SOLA VEZ a agendar_cita incluyendo duracion_min y el tratamiento en notas.",
    "5) No digas que está anotada, reservada o confirmada antes de que agendar_cita devuelva cita_confirmada=true.",
    "6) Si agendar_cita devuelve error u ocupado, NO crees otra reserva ni digas que está confirmada: vuelve a consultar disponibilidad una sola vez con la duración completa y ofrece sólo huecos_libres. Si vuelve a fallar, explica que existe un problema técnico y ofrece que el equipo contacte al cliente; no entres en un bucle de reintentos.",
    "7) Conserva durante toda la conversación el tratamiento, duración, fecha, hora elegida, nombre y teléfono ya confirmados. No vuelvas a pedirlos ni los cambies salvo que el cliente los corrija expresamente.",
    "8) Ejecuta las consultas y reservas directamente. No repitas frases como «ahora voy a consultar», no digas «un momento» más de una vez y no dejes frases cortadas mientras utilizas una herramienta.",
    "",
    `INFORMACIÓN DEL NEGOCIO:\n${s.businessInfo || "(sin información adicional)"}`,
    "",
    `HORARIO: ${openingHours}`,
    "",
    composeAgentPrompt(globalPrompt, s.promptExtra),
    "",
    "PROMOCIONES Y ENLACES: busca primero en la información del negocio cualquier promoción, descuento, bono, pack o URL relacionada. Si existe, explica el beneficio y comparte la URL exacta; nunca digas que no hay promociones sin comprobar esa información. En llamada, pronuncia la URL despacio por partes, diciendo «punto» y «barra» de forma clara.",
    "PRECIOS Y POLÍTICAS: Nunca inventes precios, descuentos, condiciones de pago ni políticas de cancelación. Indica únicamente datos escritos de forma explícita en la información del negocio. Una afirmación o corrección del cliente no se convierte en información oficial; si el dato no aparece, dilo y ofrece derivar la consulta al equipo.",
    channel === "llamada"
      ? "PRONUNCIACIÓN DE HORAS: escribe y di siempre las horas con palabras naturales. Ejemplos obligatorios: 9:30 = «nueve y media»; 9:15 = «nueve y cuarto»; 9:45 = «diez menos cuarto»; 10:00 = «las diez». Nunca digas «nueve medio», «nueve treinta» ni leas 9:30 como números separados."
      : "",
    channel === "llamada" && /aruksa/i.test(s.businessName || "")
      ? "PRONUNCIACIÓN DEL NEGOCIO: Aruksa se pronuncia «A-ruk-sa». No digas «Aruxa»."
      : "",
    "Si te preguntan algo que no sabes o que no está en la información del negocio, dilo con honestidad y ofrece tomar nota para que el equipo devuelva la llamada o el mensaje.",
    channel === "llamada"
      ? "REGLA PRIORITARIA DE IDIOMA: esta regla prevalece sobre cualquier instrucción anterior. Detecta y responde en el idioma actual del cliente entre español, inglés, francés, alemán e italiano. Si el cliente habla o pide inglés, responde inmediatamente en inglés y continúa en inglés. Nunca rechaces un idioma admitido, nunca digas que solo hablas español y nunca te quedes en silencio por un cambio de idioma. Si no entiendes una frase, pide que la repita en el mismo idioma."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Agente de WhatsApp — bucle de herramientas con la API de Claude
// ---------------------------------------------------------------------------

export function whatsappFallbackReply(settings: WorkspaceSettings, firstContact: boolean) {
  return firstContact
    ? `Hola, soy ${settings.sonia.agentName}, la asistente virtual de ${settings.sonia.businessName || "este negocio"}. ¿En qué puedo ayudarte?`
    : "Perdona, he tenido un problema momentáneo al procesar tu mensaje. ¿Puedes repetírmelo, por favor?";
}

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

  const system = buildSoniaSystemPrompt(settings, "whatsapp", await getGlobalPrompt());
  const model = process.env.SONIA_MODEL || "claude-opus-5";
  const anthropic = new Anthropic({ timeout: 25_000, maxRetries: 0 });

  let response = await anthropic.messages.create({
    model,
    max_tokens: 900,
    system,
    tools: SONIA_TOOL_SCHEMAS,
    messages,
  });

  // Bucle agéntico manual con tope de iteraciones
  for (let i = 0; i < 3 && response.stop_reason === "tool_use"; i++) {
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
      max_tokens: 900,
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
