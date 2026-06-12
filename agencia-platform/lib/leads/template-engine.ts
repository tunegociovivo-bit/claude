/**
 * Template engine de mensajes. Resuelve placeholders {{var}} a partir
 * de un Lead + sus competidores + opener IA.
 *
 * Migra NVL_Template_Engine.
 */

import { prisma } from "@/lib/db/prisma";
import { pickNegativeReview, clip } from "./reviews";

export const SUPPORTED_PLACEHOLDERS = [
  "nombre_negocio",
  "direccion",
  "provincia",
  "telefono",
  "web",
  "rating",
  "rating_estrellas",
  "resenas",
  "pct_positivas",
  "pct_negativas",
  "posicion",
  "keyword",
  "competidor_top",
  "competidor_top2",
  "competidor_top3",
  "competidores_lista",
  "score",
  "urgencia",
  "opener_ia",
  // Enlace a la demo pública de cómo se vería SU negocio en Bubui.
  "demo_bubui",
  // Reseña negativa real (requiere enriquecer el lead con Place Details).
  "resena_negativa",
  "resena_negativa_fecha",
  "resena_negativa_autor"
];

function starsFor(rating: number | null): string {
  if (rating == null) return "—";
  const r = Math.round(rating);
  return "★".repeat(r) + "☆".repeat(Math.max(0, 5 - r));
}

export async function renderTemplate(opts: {
  workspaceId: string;
  body: string;
  leadId: string;
}): Promise<string> {
  const lead = await prisma.lead.findFirst({
    where: { id: opts.leadId, workspaceId: opts.workspaceId },
    include: {
      competitors: { orderBy: { position: "asc" }, take: 3 },
      search: { select: { keyword: true } }
    }
  });
  if (!lead) throw new Error("Lead no encontrado");

  // Si el lead no tiene competidores explícitos (búsquedas antiguas, plugin
  // legacy, etc.), los inferimos en el momento desde los otros leads de la
  // misma búsqueda + provincia ordenados por posición. Así el placeholder
  // {{competidor_top}} no aparece vacío en el mensaje renderizado.
  let competitorNames = lead.competitors.map((c) => c.name);
  if (competitorNames.length === 0 && lead.searchId) {
    const peers = await prisma.lead.findMany({
      where: {
        workspaceId: opts.workspaceId,
        searchId: lead.searchId,
        province: lead.province ?? undefined,
        id: { not: lead.id },
        position: { not: null }
      },
      orderBy: { position: "asc" },
      take: 3,
      select: { name: true }
    });
    competitorNames = peers.map((p) => p.name);
  }

  const vars: Record<string, string> = {
    nombre_negocio: lead.name ?? "",
    direccion: lead.formattedAddress ?? lead.address ?? "",
    provincia: lead.province ?? "",
    telefono: lead.phone ?? lead.internationalPhone ?? "",
    web: lead.website ?? "",
    rating: lead.rating != null ? String(lead.rating) : "",
    rating_estrellas: starsFor(lead.rating ?? null),
    resenas: String(lead.reviewsCount ?? 0),
    pct_positivas: lead.positivePct != null ? `${lead.positivePct}%` : "",
    pct_negativas: lead.negativePct != null ? `${lead.negativePct}%` : "",
    posicion: lead.position != null ? String(lead.position) : "",
    keyword: lead.search?.keyword ?? "",
    competidor_top: competitorNames[0] ?? "",
    competidor_top2: competitorNames[1] ?? "",
    competidor_top3: competitorNames[2] ?? "",
    competidores_lista: competitorNames.slice(0, 3).join(", "),
    score: lead.score != null ? String(lead.score) : "",
    urgencia: lead.urgency ?? "",
    opener_ia: lead.aiOpener ?? "",
    // Enlace a la demo personalizada del negocio en Bubui (captación viral).
    demo_bubui: `${process.env.NEXT_PUBLIC_APP_URL || "https://hub.negociovivo.app"}/bubui/demo/${lead.id}`,
    ...(() => {
      const neg = pickNegativeReview(lead.reviewsJson);
      return {
        resena_negativa: neg ? `"${clip(neg.text, 220)}"` : "",
        resena_negativa_fecha: neg?.when ?? "",
        resena_negativa_autor: neg?.author ?? ""
      };
    })()
  };

  let out = opts.body;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g");
    out = out.replace(re, v);
  }
  // Limpieza: si un placeholder se queda vacío, no dejes dobles espacios ni
  // ", ," colgando justo antes/después del hueco.
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

/**
 * Variaciones léxicas y de formato para reducir fingerprinting WhatsApp.
 * No cambia el significado del mensaje, sólo rota microestructuras.
 */
const GREETINGS = ["Hola", "Buenas", "Buenos días", "Qué tal"];
const SYNONYMS: Array<[RegExp, string[]]> = [
  [/una pregunta rápida/gi, ["una duda rápida", "una cosa rápida", "una preguntilla rápida"]],
  [/estaba revisando/gi, ["estaba mirando", "he estado revisando", "estaba echando un ojo"]],
  [/te escribo porque/gi, ["te escribo ya que", "te contacto porque", "te paso un mensaje porque"]],
  [/me ha llamado la atención/gi, ["me ha resultado curioso", "me ha llamado la atención"]],
  [/me gustaría/gi, ["querría", "me gustaría", "quería"]]
];
const ENDS = [".", "", " :)", "", "", "."];
const EMOJIS = ["🙌", "👋", "✨", "📍", "👀", "🙂"];

export function varyMessage(text: string, seed: string): string {
  const hash = stringHash(seed);
  let out = text;

  // Saludo (si empieza con Hola/Buenas/etc.)
  out = out.replace(/^(Hola|Buenas|Buenos días|Qué tal)/i, () => GREETINGS[hash % GREETINGS.length]);

  // Sinonimia
  for (const [re, opts] of SYNONYMS) {
    if (re.test(out)) {
      const pick = opts[hash % opts.length];
      out = out.replace(re, pick);
    }
  }

  // Saltos de párrafo: 50/50 un \n o \n\n al cierre de cada bloque
  if ((hash >> 4) % 2 === 0) {
    out = out.replace(/\n\n/g, "\n");
  }

  // Final de frase: añadir o variar el último carácter
  if (!/[.!?]$/.test(out)) {
    out += ENDS[(hash >> 6) % ENDS.length];
  }

  // Emoji esporádico (1/6) al final
  if ((hash >> 8) % 6 === 0) {
    out += " " + EMOJIS[(hash >> 10) % EMOJIS.length];
  }
  return out;
}

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
