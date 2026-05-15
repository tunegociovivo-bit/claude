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
};

export type GenerateMonthResult = {
  createdIds: string[];
  count: number;
  model: string;
  imagesGenerated: number;
  imagesFailed: number;
  imageErrors: string[]; // primeros 5 mensajes únicos
};

const DEFAULT_MIX = { imagen: 50, reel: 25, carrusel: 15, story: 10, video: 0 };

function lengthBand(v: number): { label: string; words: string } {
  if (v < 25) return { label: "ultra-directo", words: "40-100 palabras" };
  if (v < 50) return { label: "corto", words: "60-180 palabras" };
  if (v < 75) return { label: "medio", words: "100-300 palabras" };
  return { label: "largo", words: "200-450 palabras" };
}

function buildSystemPrompt(client: any, networks: string[], perNetworkCopy: boolean) {
  const brief = client.brandBrief?.trim() || "(sin brief — usa tono profesional neutro)";
  const guide = client.styleGuideCached?.trim();
  const competitors = client.competitors?.trim();
  const colors = `${client.brandColorPrimary} / ${client.brandColorAccent} / ${client.brandColorText}`;

  return [
    `Eres el redactor editorial de una agencia de marketing que gestiona el cliente "${client.name}".`,
    `Tu trabajo es generar un mes completo de publicaciones para redes sociales (${networks.join(", ")}).`,
    ``,
    `## Brief de marca del cliente`,
    brief,
    ``,
    competitors ? `## Competidores de referencia\n${competitors}` : "",
    guide ? `## Guía de estilo visual\n${guide}` : "",
    `## Colores corporativos\n${colors}`,
    ``,
    `## Reglas de redacción`,
    `- Cada publicación tiene su propio enfoque (educativo, emocional, urgencia, testimonio, dato curioso, etc.). Varía el tono entre posts del mismo mes.`,
    `- Evita CTA repetitivos. Si necesitas CTA, varíalo entre "Pide cita", "Hablemos", "Descubre", "Reserva ahora", etc.`,
    `- No uses corporate-speak ("sinergias", "soluciones a medida"…) salvo que el brief lo pida.`,
    `- Hashtags: mezcla 50% medios (50K-500K posts), 30% nicho, 20% brand.`,
    perNetworkCopy
      ? `- Para cada publicación entrega también copys adaptados por red: Instagram conciso + emoji, LinkedIn más sobrio y B2B, Facebook intermedio, TikTok ultra-corto, X telegráfico.`
      : "",
    `- Las fechas deben distribuirse por el mes. No pongas dos posts el mismo día. Hora típica: 10:00, 12:00, 18:30. Evita madrugadas.`,
    ``,
    `Devuelve SIEMPRE un JSON con la forma indicada por el schema.`
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
}) {
  const band = lengthBand(opts.copyLength);
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
    `## Longitud del copy`,
    `${opts.copyLength}/100 → ${band.label} (${band.words})`,
    ``,
    opts.extraGuidance ? `## Instrucción extra del usuario\n${opts.extraGuidance}` : "",
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
    firstComment: { type: "string" }
  };
  const required = ["title", "content", "hashtags", "format", "dayOfMonth", "hourOfDay"];

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
      competitors: true
    }
  });
  if (!client) throw new Error("Cliente no encontrado");

  const mix = { ...DEFAULT_MIX, ...(opts.mix ?? {}) };
  const copyLength = opts.copyLength ?? 50;
  const perNetwork = opts.perNetworkCopy ?? opts.networks.length > 1;

  const system = buildSystemPrompt(client, opts.networks, perNetwork);
  const user = buildUserPrompt({
    month: opts.month,
    count: opts.count,
    mix: mix as any,
    copyLength,
    extraGuidance: opts.extraGuidance
  });

  const responseSchema = buildResponseSchema({
    networks: opts.networks,
    perNetworkCopy: perNetwork
  });
  const ai = await completeJson<{ posts: any[] }>({
    workspaceId: opts.workspaceId,
    system,
    user,
    schema: responseSchema as any,
    maxTokens: Math.max(4096, 800 * opts.count)
  });

  const [y, m] = opts.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Validar y normalizar
  const usedDays = new Set<number>();
  const status = opts.status ?? "DRAFT";

  const records: Prisma.EditorialPostCreateManyInput[] = [];
  for (const p of ai.posts ?? []) {
    let day = Number(p.dayOfMonth);
    if (!Number.isFinite(day) || day < 1) day = 1;
    if (day > daysInMonth) day = daysInMonth;
    // Si ya hay 2 posts ese día, mover al siguiente día disponible
    let safety = 0;
    while (Array.from(usedDays.values()).filter((d) => d === day).length >= 2 && safety < daysInMonth) {
      day = (day % daysInMonth) + 1;
      safety++;
    }
    usedDays.add(day);

    let hour = Number(p.hourOfDay);
    if (!Number.isFinite(hour) || hour < 6 || hour > 22) hour = 12;
    const scheduledFor = new Date(Date.UTC(y, m - 1, day, hour, 0, 0));

    const copyByNetwork =
      p.copyByNetwork && typeof p.copyByNetwork === "object" && !Array.isArray(p.copyByNetwork)
        ? p.copyByNetwork
        : null;

    records.push({
      workspaceId: opts.workspaceId,
      clientId: opts.clientId,
      title: String(p.title ?? "").slice(0, 200) || "Publicación generada",
      content: String(p.content ?? ""),
      hashtags: String(p.hashtags ?? "") || null,
      firstComment: p.firstComment ? String(p.firstComment) : null,
      copyByNetwork: copyByNetwork as any,
      format: String(p.format ?? "imagen"),
      networks: JSON.stringify(opts.networks),
      scheduledFor,
      status,
      mediaUrls: "[]"
    });
  }

  if (records.length === 0) {
    return {
      createdIds: [],
      count: 0,
      model: DEFAULT_MODEL,
      imagesGenerated: 0,
      imagesFailed: 0,
      imageErrors: []
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
      try {
        await generateImageForPost({
          workspaceId: opts.workspaceId,
          userId: opts.userId,
          postId,
          quality
        });
        imagesGenerated++;
      } catch (e: any) {
        imagesFailed++;
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
    imageErrors
  };
}
