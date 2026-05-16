/**
 * Generación masiva de publicaciones del mes con IA.
 * Migra "Generar mes con Claude" del plugin NV Dashboard.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson, DEFAULT_MODEL } from "@/lib/ai/anthropic";
import type { Prisma } from "@prisma/client";

export type GenerateMonthOptions = {
  workspaceId: string;
  userId?: string | null;
  clientId: string;
  month: string; // YYYY-MM
  count: number; // ~14
  mix?: Partial<Record<"imagen" | "reel" | "carrusel" | "story" | "video", number>>;
  networks: string[]; // ["instagram", "facebook", "linkedin", ...]
  copyLength?: number; // 0-100, default 50
  perNetworkCopy?: boolean; // si true, pide copy adaptado por red
  extraGuidance?: string; // override / instrucción adicional del usuario
  status?: "DRAFT" | "REVIEW"; // estado en que se crean (default DRAFT)
  // Imagen IA opcional. Si generateImages=true, tras crear cada
  // publicación se llama a generateImageForPost. El job sigue corriendo
  // aunque algunas fallen (e.g. sin saldo OpenAI o sin R2).
  generateImages?: boolean;
  imageQuality?: "low" | "medium" | "high";
  // Callback opcional para reportar progreso en el job.
  onProgress?: (msg: string, pct: number) => Promise<void> | void;
  // Modo "single post": cuando se rellena `singleTopic`, count se fuerza
  // a 1, el título y la fecha vienen del usuario (no los inventa Claude)
  // y el formato se respeta tal cual. Útil para "Nueva publicación con
  // IA" desde el calendario.
  singleTopic?: string;
  singleFormat?: string;
  singleScheduledFor?: Date;
  // Hints opcionales para guiar la imagen. Vacío = Claude decide sola.
  // imageIncludeHint: cosas/personas/objetos QUE SÍ deben aparecer.
  // imageAvoidHint: cosas/personas/objetos QUE NO deben aparecer (negative).
  imageIncludeHint?: string;
  imageAvoidHint?: string;
  // Pillars temáticos con peso (suma libre, se normaliza). Si vacío,
  // Claude decide la mezcla. Ej: { educativo: 30, producto: 30,
  // testimonio: 20, social: 20 }.
  pillars?: Record<string, number>;
  // Restricciones de calendario. Si vacío, Claude reparte como ve.
  // allowedDaysOfWeek: array de 0=domingo..6=sábado.
  // preferredHours: array de horas 0..23.
  allowedDaysOfWeek?: number[];
  preferredHours?: number[];
  // Personas del roster que SÍ deben aparecer en TODAS las imágenes de
  // esta tanda (override del auto-detect por mención en el copy).
  useRosterPersons?: string[];
  // ID del BackgroundJob para chequear cancelRequested entre
  // iteraciones (cancelación cooperativa).
  jobId?: string;
};

export type GenerateMonthResult = {
  createdIds: string[];
  count: number;
  model: string;
  imagesGenerated: number;
  imagesFailed: number;
  imageErrors: string[]; // primeros 5 mensajes únicos
  /** IDs de posts cuya imagen falló (para retry directo). */
  failedImagePostIds: string[];
  /** Sistema/usuario prompt que se mandó a Claude (auditoría). */
  systemPrompt?: string;
  userPrompt?: string;
};

const DEFAULT_MIX = { imagen: 50, reel: 25, carrusel: 15, story: 10, video: 0 };

function lengthBand(v: number): { label: string; words: string } {
  if (v < 25) return { label: "ultra-directo", words: "40-100 palabras" };
  if (v < 50) return { label: "corto", words: "60-180 palabras" };
  if (v < 75) return { label: "medio", words: "100-300 palabras" };
  return { label: "largo", words: "200-450 palabras" };
}

type RosterPerson = { name: string; type: string; photoCount: number; photoUrls: string[] };

function buildRoster(client: any): RosterPerson[] {
  const refs: any[] = Array.isArray(client?.referenceImages) ? client.referenceImages : [];
  const map = new Map<string, RosterPerson>();
  for (const r of refs) {
    const name = (r?.personName ?? "").toString().trim();
    if (!name) continue;
    const url = typeof r?.url === "string" ? r.url : null;
    const key = name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        name,
        type: r.type ?? "general",
        photoCount: 1,
        photoUrls: url ? [url] : []
      });
    } else {
      const p = map.get(key)!;
      p.photoCount++;
      if (url) p.photoUrls.push(url);
    }
  }
  return Array.from(map.values());
}

function buildSystemPrompt(client: any, networks: string[], perNetworkCopy: boolean) {
  const brief = client.brandBrief?.trim() || "(sin brief — usa tono profesional neutro)";
  const guide = client.styleGuideCached?.trim();
  const competitors = client.competitors?.trim();
  const colors = `${client.brandColorPrimary} / ${client.brandColorAccent} / ${client.brandColorText}`;
  const roster = buildRoster(client);
  const namesCsv = roster.map((p) => p.name).join(", ");
  const rosterBlock =
    roster.length > 0
      ? `## Roster del cliente (personas con fotos de referencia)
${roster.map((p) => `- ${p.name} (${p.type}, ${p.photoCount} fotos adjuntas en este mensaje)`).join("\n")}

CRÍTICO sobre el roster — te HE ADJUNTADO al inicio de este mensaje las fotos reales de estas personas. ANTES de empezar a escribir publicaciones, MIRA las fotos atentamente y construye una descripción física PRECISA de cada persona (edad aproximada, color y forma de pelo, presencia/forma de barba, complexión, tono de piel, vestimenta típica). Usa esa descripción cuando el copy mencione alguno de estos nombres (${namesCsv}).

Reglas:
- El image_prompt DEBE describir físicamente a TODAS las personas del copy en escena, enumeradas, SIN nombres (gpt-image-1 no entiende nombres). Ej: en vez de "Rochar smiling", pon "a man in his late 40s with short salt-and-pepper hair and a well-groomed grey beard, wearing a white doctor coat over a dark shirt, warm calm expression, looking directly at camera".
- Cada miembro del roster es una persona ÚNICA — nunca dupliques (no pongas "two men with beard" si Rochar es la única persona mencionada).
- Si el copy es genérico sobre "el equipo" sin nombres, describe la escena con ${roster.length} persona(s) consistentes con las fotos del roster.
- NUNCA generes una persona genérica si el copy menciona un nombre del roster.`
      : "";

  return [
    `Eres el redactor editorial de una agencia de marketing que gestiona el cliente "${client.name}".`,
    `Tu trabajo es generar un mes completo de publicaciones para redes sociales (${networks.join(", ")}).`,
    `Para cada publicación generas TANTO el copy textual COMO un plan visual estructurado (image_prompt + headline_lines + text_placement) que se usará para componer la imagen final con IA.`,
    ``,
    `## Brief de marca del cliente`,
    brief,
    ``,
    competitors ? `## Competidores de referencia\n${competitors}` : "",
    guide ? `## Guía de estilo visual (extraída previamente de las refs visuales del cliente, en inglés)\n${guide}` : "",
    `## Colores corporativos (hex)\nprimary=${client.brandColorPrimary}, accent=${client.brandColorAccent}, text_on_primary=${client.brandColorText}`,
    ``,
    rosterBlock,
    ``,
    `## Reglas de redacción del COPY`,
    `- Cada publicación tiene su propio enfoque (educativo, emocional, urgencia, testimonio, dato curioso, etc.). Varía el tono entre posts.`,
    `- Evita CTA repetitivos. Varía entre "Pide cita", "Hablemos", "Descubre", "Reserva ahora", etc.`,
    `- No uses corporate-speak salvo que el brief lo pida.`,
    `- Hashtags: 50% medios, 30% nicho, 20% brand.`,
    perNetworkCopy
      ? `- Para cada publicación entrega también copys adaptados por red.`
      : "",
    `- Fechas distribuidas por el mes. Máx 2 publicaciones por día. Hora típica: 10:00, 12:00, 18:30. Evita madrugadas.`,
    ``,
    `## Reglas del PLAN VISUAL (image_prompt + headline_lines + text_placement)`,
    `- "image_prompt": EN INGLÉS, 120-220 palabras. PROMPT COMPLETO listo para gpt-image-1. Estructura:`,
    `  (a) ESCENA CONCRETA del tema con subjects exactos/acción/lugar — anti-cliché del sector.`,
    `  (b) Si el copy menciona persona(s) del roster, ENUMERA físicamente cada una sin nombres (ej: "a mature man with short dark hair and trimmed beard wearing white coat, looking confidently at camera").`,
    `  (c) Composición y framing.`,
    `  (d) Iluminación específica.`,
    `  (e) Estilo fotográfico (editorial / documentary / lifestyle).`,
    `  (f) Paleta hex (usa la guía cacheada si existe).`,
    `  (g) "ample empty negative space at the [TOP/CENTER/BOTTOM]" coincidiendo con text_placement.`,
    `  (h) Photographic realism, no illustrations, no AI-art look.`,
    `  (i) MUY IMPORTANTE: "no readable text, no letters, no numbers, no watermarks, no signs" — el texto lo componemos NOSOTROS encima.`,
    `- "headline_lines": ARRAY de 2-4 líneas con jerarquía. Cada línea: {text, size, color, weight}.`,
    `  · size: sm | md | lg | xl`,
    `  · color: white | accent | primary`,
    `  · weight: regular | bold`,
    `  · Identifica el NOMBRE DE MARCA o concepto clave y dale {size:xl, color:accent, weight:bold}.`,
    `  · El resto en blanco/primary con tamaños menores. MAYÚSCULAS para impacto.`,
    `  · MAX 6 palabras por línea para que quepa al hacer overlay.`,
    `- "text_placement": top | center | bottom`,
    `  · DEBE coincidir con la zona de espacio negativo reservada en image_prompt.`,
    `  · Si la persona va arriba o centro → bottom. Si la persona va abajo → top.`,
    `  · NUNCA pongas top si la persona ocupa la mitad superior (taparías la cara).`,
    `  · NUNCA pongas center si hay UNA SOLA persona centrada — taparías su cara o torso. Mueve a bottom o top.`,
    `  · REGLA DE ORO: el bloque de texto va en una franja horizontal completamente VACÍA (pared lisa, cielo, escritorio limpio, suelo). Si tu image_prompt no garantiza una franja vacía de ~35% de la altura libre de personas en la zona "text_placement", REESCRIBE el image_prompt para que sí.`,
    `  · Para fotos donde el sujeto principal aparece sentado mirando a cámara en el centro, lo correcto es: composición con espacio negativo a la IZQUIERDA del sujeto + text_placement="center" (el scrim del overlay queda en la mitad izquierda). En este caso, el image_prompt debe especificar "subject seated on the right third of the frame, left two-thirds clear background, ample negative space on the left for vertical text overlay".`,
    ``,
    `Devuelve SIEMPRE un JSON con la forma del schema. Sin preámbulos ni comentarios fuera del JSON.`
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(opts: {
  month: string;
  count: number;
  mix: Required<GenerateMonthOptions>["mix"];
  copyLength: number;
  extraGuidance?: string;
  singleTopic?: string;
  singleFormat?: string;
  imageIncludeHint?: string;
  imageAvoidHint?: string;
  imageGlobalAvoid?: string;
  pillars?: Record<string, number>;
  allowedDaysOfWeek?: number[];
  preferredHours?: number[];
  useRosterPersons?: string[];
}) {
  const band = lengthBand(opts.copyLength);

  // Bloque opcional de instrucciones visuales positivas/negativas. Se
  // inyectan en el prompt del usuario para que Claude las incorpore al
  // image_prompt de cada publicación.
  const imageHints = (() => {
    const blocks: string[] = [];
    if (opts.imageIncludeHint?.trim()) {
      blocks.push(
        `## Imagen — qué SÍ debe aparecer (positivo)\n${opts.imageIncludeHint.trim()}\n\nIncorpora estos elementos en el campo "image_prompt" de cada publicación de forma natural y coherente con el copy.`
      );
    }
    // Combinamos el negativo de la tanda con el negativo permanente del
    // cliente — se mandan los dos como una sola lista al modelo.
    const avoid: string[] = [];
    if (opts.imageGlobalAvoid?.trim()) avoid.push(opts.imageGlobalAvoid.trim());
    if (opts.imageAvoidHint?.trim()) avoid.push(opts.imageAvoidHint.trim());
    if (avoid.length > 0) {
      blocks.push(
        `## Imagen — qué NO debe aparecer (negativo)\n${avoid.join("\n")}\n\nMenciona explícitamente al final de cada "image_prompt": "do not include: [lista de cosas a evitar en inglés]". Refuerza la prohibición incluso si el copy podría sugerirlos.`
      );
    }
    return blocks.join("\n\n");
  })();

  // Pillars temáticos: si el user los pasa con peso, los convertimos
  // en porcentajes y se los damos a Claude como reparto sugerido.
  const pillarsBlock = (() => {
    if (!opts.pillars) return "";
    const entries = Object.entries(opts.pillars).filter(([, v]) => v && v > 0);
    if (entries.length === 0) return "";
    const total = entries.reduce((a, [, v]) => a + v, 0);
    const lines = entries.map(([k, v]) => `- ${k}: ${Math.round((v / total) * 100)}%`).join("\n");
    return `## Pillars temáticos (reparto aproximado del mes)\n${lines}\n\nElige el pillar de cada publicación coherente con este mix global. No tiene que ser exacto — aproxímalo lo mejor que puedas dentro de N publicaciones.`;
  })();

  // Restricciones duras de calendario.
  const calendarBlock = (() => {
    const blocks: string[] = [];
    if (opts.allowedDaysOfWeek && opts.allowedDaysOfWeek.length > 0 && opts.allowedDaysOfWeek.length < 7) {
      const dayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      const allowed = opts.allowedDaysOfWeek.map((d) => dayNames[d]).join(", ");
      blocks.push(
        `## Días permitidos\nSólo puedes programar publicaciones en: ${allowed}. Otros días están PROHIBIDOS. Si el "dayOfMonth" elegido cae en un día prohibido, mueve al día permitido más cercano.`
      );
    }
    if (opts.preferredHours && opts.preferredHours.length > 0) {
      blocks.push(
        `## Horas preferidas\nUsa exclusivamente estas horas (formato 0-23) para el campo "hourOfDay": ${opts.preferredHours.join(", ")}. No uses ninguna otra.`
      );
    }
    return blocks.join("\n\n");
  })();

  // Personas del roster que el user fuerza que aparezcan.
  const rosterBlock = (() => {
    if (!opts.useRosterPersons || opts.useRosterPersons.length === 0) return "";
    return `## Personas del roster forzadas\nEstas personas DEBEN aparecer (o ser mencionadas explícitamente) en TODAS las publicaciones de esta tanda: ${opts.useRosterPersons.join(", ")}. Describe sus rasgos físicos en el image_prompt (sin nombres) tal y como te los he indicado en el system.`;
  })();

  // Modo single post: el usuario pasa título y formato concretos.
  if (opts.singleTopic) {
    return [
      `## Publicación individual a generar`,
      `Tema/título fijo del usuario: "${opts.singleTopic}"`,
      opts.singleFormat ? `Formato fijo: ${opts.singleFormat}` : "",
      ``,
      `Genera UNA sola publicación basada exactamente en ese tema/título. Devuelve el array "posts" con un único elemento.`,
      `Usa ese mismo string como "title". El "format" debe ser exactamente "${opts.singleFormat ?? "imagen"}".`,
      `Los campos "dayOfMonth" y "hourOfDay" no importan — pon cualquier valor válido, serán ignorados.`,
      ``,
      `## Longitud del copy`,
      `${opts.copyLength}/100 → ${band.label} (${band.words})`,
      ``,
      opts.extraGuidance ? `## Instrucción extra del usuario\n${opts.extraGuidance}` : "",
      rosterBlock,
      imageHints
    ]
      .filter(Boolean)
      .join("\n");
  }

  const mixLines = Object.entries(opts.mix)
    .filter(([, v]) => v && v > 0)
    .map(([k, v]) => `- ${k}: ${v}% del total`)
    .join("\n");

  return [
    `## Mes a generar`,
    `${opts.month} — ${opts.count} publicaciones.`,
    ``,
    `## Mix de formatos (aprox)`,
    mixLines,
    ``,
    pillarsBlock,
    calendarBlock,
    rosterBlock,
    `## Longitud del copy`,
    `${opts.copyLength}/100 → ${band.label} (${band.words})`,
    ``,
    opts.extraGuidance ? `## Instrucción extra del usuario\n${opts.extraGuidance}` : "",
    imageHints,
    ``,
    `Genera ahora las ${opts.count} publicaciones.`
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Construye el schema de respuesta según las redes y si se quiere copy
 * adaptado por red. Mantenerlo MÍNIMO ayuda a evitar el "Grammar
 * compilation timed out" de Anthropic structured output cuando el árbol
 * es grande.
 */
function buildResponseSchema(opts: { networks: string[]; perNetworkCopy: boolean }) {
  const postProps: any = {
    title: { type: "string" },
    content: { type: "string" },
    hashtags: { type: "string" },
    format: { type: "string", enum: ["imagen", "reel", "carrusel", "story", "video"] },
    dayOfMonth: { type: "integer" },
    hourOfDay: { type: "integer" },
    firstComment: { type: "string" },
    // Plan visual: image_prompt para gpt-image-1, headline_lines para overlay sharp+SVG.
    imagePrompt: { type: "string" },
    textPlacement: { type: "string", enum: ["top", "center", "bottom"] },
    headlineLines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          size: { type: "string", enum: ["sm", "md", "lg", "xl"] },
          color: { type: "string", enum: ["white", "accent", "primary"] },
          weight: { type: "string", enum: ["regular", "bold"] }
        },
        required: ["text"]
      }
    }
  };
  const required = [
    "title",
    "content",
    "hashtags",
    "format",
    "dayOfMonth",
    "hourOfDay",
    "imagePrompt",
    "textPlacement",
    "headlineLines"
  ];

  if (opts.perNetworkCopy && opts.networks.length >= 2) {
    // Sólo declaramos las redes realmente solicitadas (no las 10 globales).
    // Cada una es string opcional.
    const networkProps: Record<string, any> = {};
    for (const n of opts.networks) {
      networkProps[n] = { type: "string" };
    }
    postProps.copyByNetwork = {
      type: "object",
      properties: networkProps
    };
  }

  return {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: postProps,
          required
        }
      }
    },
    required: ["posts"]
  };
}

export async function generateMonth(opts: GenerateMonthOptions): Promise<GenerateMonthResult> {
  const client = await prisma.client.findFirst({
    where: { id: opts.clientId, workspaceId: opts.workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      brandBrief: true,
      brandColorPrimary: true,
      brandColorAccent: true,
      brandColorText: true,
      styleGuideCached: true,
      competitors: true,
      referenceImages: true,
      imageGlobalAvoid: true
    }
  });
  if (!client) throw new Error("Cliente no encontrado");

  const isSingle = !!opts.singleTopic;
  const effectiveCount = isSingle ? 1 : opts.count;
  const mix = { ...DEFAULT_MIX, ...(opts.mix ?? {}) };
  const copyLength = opts.copyLength ?? 50;
  const perNetwork = opts.perNetworkCopy ?? opts.networks.length > 1;

  const system = buildSystemPrompt(client, opts.networks, perNetwork);
  const user = buildUserPrompt({
    month: opts.month,
    count: effectiveCount,
    mix: mix as any,
    copyLength,
    extraGuidance: opts.extraGuidance,
    singleTopic: opts.singleTopic,
    singleFormat: opts.singleFormat,
    imageIncludeHint: opts.imageIncludeHint,
    imageAvoidHint: opts.imageAvoidHint,
    imageGlobalAvoid: (client as any).imageGlobalAvoid ?? undefined,
    pillars: opts.pillars,
    allowedDaysOfWeek: opts.allowedDaysOfWeek,
    preferredHours: opts.preferredHours,
    useRosterPersons: opts.useRosterPersons
  });

  const responseSchema = buildResponseSchema({
    networks: opts.networks,
    perNetworkCopy: perNetwork
  });
  // Pasamos a Claude las fotos del roster (CEO, equipo) para que las
  // VEA y describa físicamente con detalle en cada image_prompt. Sin
  // esto el modelo de imagen genera "un señor genérico con barba" en
  // vez del CEO real. Tomamos hasta 3 fotos por persona, máx 12 fotos
  // totales (12000 input tokens aprox).
  const roster = buildRoster(client);
  const rosterPhotos: string[] = [];
  for (const p of roster) {
    for (const u of p.photoUrls.slice(0, 3)) {
      if (rosterPhotos.length < 12) rosterPhotos.push(u);
    }
  }
  const ai = await completeJson<{ posts: any[] }>({
    workspaceId: opts.workspaceId,
    system,
    user,
    schema: responseSchema as any,
    maxTokens: Math.max(4096, 800 * effectiveCount),
    imageUrls: rosterPhotos.length > 0 ? rosterPhotos : undefined
  });

  const [y, m] = opts.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Validar y normalizar
  const usedDays = new Set<number>();
  const status = opts.status ?? "DRAFT";

  const records: Prisma.EditorialPostCreateManyInput[] = [];
  for (const p of ai.posts ?? []) {
    let scheduledFor: Date;
    if (isSingle && opts.singleScheduledFor) {
      // Modo single: la fecha la ha elegido el usuario en el modal.
      scheduledFor = opts.singleScheduledFor;
    } else {
      let day = Number(p.dayOfMonth);
      if (!Number.isFinite(day) || day < 1) day = 1;
      if (day > daysInMonth) day = daysInMonth;
      // Restricción de días de la semana (allowedDaysOfWeek). Si Claude
      // metió un día prohibido, lo movemos al permitido más cercano.
      if (opts.allowedDaysOfWeek && opts.allowedDaysOfWeek.length > 0 && opts.allowedDaysOfWeek.length < 7) {
        const allowed = new Set(opts.allowedDaysOfWeek);
        let tries = 0;
        while (tries < daysInMonth) {
          const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
          if (allowed.has(dow)) break;
          day = (day % daysInMonth) + 1;
          tries++;
        }
      }
      // Si ya hay 2 posts ese día, mover al siguiente día disponible
      let safety = 0;
      while (Array.from(usedDays.values()).filter((d) => d === day).length >= 2 && safety < daysInMonth) {
        day = (day % daysInMonth) + 1;
        // Re-validar restricción de DOW
        if (opts.allowedDaysOfWeek && opts.allowedDaysOfWeek.length > 0 && opts.allowedDaysOfWeek.length < 7) {
          const allowed = new Set(opts.allowedDaysOfWeek);
          while (!allowed.has(new Date(Date.UTC(y, m - 1, day)).getUTCDay()) && safety < daysInMonth * 2) {
            day = (day % daysInMonth) + 1;
            safety++;
          }
        }
        safety++;
      }
      usedDays.add(day);

      let hour = Number(p.hourOfDay);
      if (!Number.isFinite(hour) || hour < 6 || hour > 22) hour = 12;
      // Restricción de horas preferidas: si Claude eligió una fuera de
      // la lista, la "snapeamos" a la preferida más cercana.
      if (opts.preferredHours && opts.preferredHours.length > 0) {
        let closest = opts.preferredHours[0];
        let bestDiff = Math.abs(hour - closest);
        for (const h of opts.preferredHours) {
          const d = Math.abs(hour - h);
          if (d < bestDiff) {
            bestDiff = d;
            closest = h;
          }
        }
        hour = closest;
      }
      scheduledFor = new Date(Date.UTC(y, m - 1, day, hour, 0, 0));
    }

    const copyByNetwork =
      p.copyByNetwork && typeof p.copyByNetwork === "object" && !Array.isArray(p.copyByNetwork)
        ? p.copyByNetwork
        : null;

    // Headlines: solo nos quedamos con líneas válidas
    const headlineLines = Array.isArray(p.headlineLines)
      ? (p.headlineLines as any[])
          .filter((h) => h && typeof h.text === "string" && h.text.trim())
          .map((h) => ({
            text: String(h.text).trim().slice(0, 80),
            size: ["sm", "md", "lg", "xl"].includes(h.size) ? h.size : "md",
            color: ["white", "accent", "primary"].includes(h.color) ? h.color : "white",
            weight: h.weight === "bold" ? "bold" : "regular"
          }))
      : null;
    const textPlacement = ["top", "center", "bottom"].includes(p.textPlacement) ? p.textPlacement : null;
    const imagePrompt = typeof p.imagePrompt === "string" && p.imagePrompt.trim() ? p.imagePrompt.trim() : null;

    // Modo single: forzamos title y format del usuario, ignorando lo
    // que Claude haya inventado (a veces se desvía aunque el prompt lo
    // pida explícito).
    const finalTitle = isSingle && opts.singleTopic
      ? opts.singleTopic.slice(0, 200)
      : String(p.title ?? "").slice(0, 200) || "Publicación generada";
    const finalFormat = isSingle && opts.singleFormat
      ? opts.singleFormat
      : String(p.format ?? "imagen");

    records.push({
      workspaceId: opts.workspaceId,
      clientId: opts.clientId,
      title: finalTitle,
      content: String(p.content ?? ""),
      hashtags: String(p.hashtags ?? "") || null,
      firstComment: p.firstComment ? String(p.firstComment) : null,
      copyByNetwork: copyByNetwork as any,
      format: finalFormat,
      networks: JSON.stringify(opts.networks),
      scheduledFor,
      status,
      mediaUrls: "[]",
      // Plan visual estructurado
      headlineLines: headlineLines && headlineLines.length > 0 ? (headlineLines as any) : undefined,
      imagePrompt: imagePrompt ?? undefined,
      textPlacement: textPlacement ?? undefined
    });
  }

  if (records.length === 0) {
    return {
      createdIds: [],
      count: 0,
      model: DEFAULT_MODEL,
      imagesGenerated: 0,
      imagesFailed: 0,
      imageErrors: [],
      failedImagePostIds: [],
      systemPrompt: system,
      userPrompt: user
    };
  }

  // Crear de uno en uno para obtener IDs (createMany no devuelve IDs)
  const ids: string[] = [];
  for (const r of records) {
    const created = await prisma.editorialPost.create({ data: r });
    ids.push(created.id);
  }

  // Generación de imágenes opcional (post-texto). No bloquea si alguna falla.
  let imagesGenerated = 0;
  let imagesFailed = 0;
  const imageErrors: string[] = [];
  const failedImagePostIds: string[] = [];
  if (opts.generateImages && ids.length > 0) {
    // Import dinámico para no acoplar el bundle si no se usa.
    const { generateImageForPost } = await import("./generate-image");
    const quality = opts.imageQuality ?? "medium";
    let idx = 0;
    for (const postId of ids) {
      idx++;
      try {
        await opts.onProgress?.(`Generando imagen ${idx}/${ids.length}…`, 50 + Math.floor((idx / ids.length) * 45));
      } catch {}
      // Antes de cada imagen, comprobamos cancelRequested del job.
      // Si sí, paramos pero conservamos lo ya creado.
      if (opts.jobId) {
        try {
          const fresh = await prisma.backgroundJob.findUnique({
            where: { id: opts.jobId },
            select: { cancelRequested: true }
          });
          if (fresh?.cancelRequested) {
            await opts.onProgress?.(`Cancelado por el usuario en imagen ${idx}/${ids.length}`, 95);
            break;
          }
        } catch {}
      }
      try {
        await generateImageForPost({
          workspaceId: opts.workspaceId,
          userId: opts.userId,
          postId,
          quality,
          forceRosterPersons: opts.useRosterPersons
        });
        imagesGenerated++;
      } catch (e: any) {
        imagesFailed++;
        failedImagePostIds.push(postId);
        const msg = String(e?.message ?? e).slice(0, 200);
        if (imageErrors.length < 5 && !imageErrors.includes(msg)) imageErrors.push(msg);
      }
    }
  }

  return {
    createdIds: ids,
    count: ids.length,
    model: DEFAULT_MODEL,
    imagesGenerated,
    imagesFailed,
    imageErrors,
    failedImagePostIds,
    systemPrompt: system,
    userPrompt: user
  };
}
