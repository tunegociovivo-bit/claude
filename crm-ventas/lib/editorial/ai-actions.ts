/**
 * Acciones rápidas de IA al editar una publicación (Claude Widget del plugin).
 * Toma el copy actual + brief del cliente y devuelve un copy modificado.
 */

import { complete } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";

export type AiAction =
  | "improve" // mejorar copy
  | "casual" // más casual
  | "corporate" // más corporate / B2B
  | "shorter" // acortar a la mitad
  | "longer" // alargar el doble
  | "hashtags" // generar 10 hashtags
  | "variants" // 3 variantes
  | "translate_en" // traducir a inglés
  | "custom";

type ActionDef = {
  label: string;
  emoji: string;
  systemAddendum: string;
  expectsList?: boolean; // si true, devolvemos array (variantes / hashtags)
};

export const AI_ACTIONS: Record<AiAction, ActionDef> = {
  improve: {
    label: "Mejorar copy",
    emoji: "✍️",
    systemAddendum:
      "Mejora el copy manteniendo la idea principal. Hazlo más claro, más natural y con mejor ritmo. No inventes datos."
  },
  casual: {
    label: "Más casual",
    emoji: "😊",
    systemAddendum:
      "Reescribe en tono casual y cercano. Quita corporativismos. Usa frases cortas. Tú a tú con el lector."
  },
  corporate: {
    label: "Más corporate",
    emoji: "💼",
    systemAddendum:
      "Reescribe en tono más sobrio y B2B. Profesional pero sin clichés (evita 'sinergias', 'soluciones a medida')."
  },
  shorter: {
    label: "Acortar a la mitad",
    emoji: "📏",
    systemAddendum: "Acorta el copy a aproximadamente la mitad, manteniendo idea principal y CTA si lo había."
  },
  longer: {
    label: "Doblar longitud",
    emoji: "📐",
    systemAddendum:
      "Alarga el copy aproximadamente al doble. Añade detalles concretos, beneficios y un CTA. Sin paja."
  },
  hashtags: {
    label: "Generar 10 hashtags",
    emoji: "#️⃣",
    systemAddendum:
      "Genera EXACTAMENTE 10 hashtags relevantes: 5 medio (50K-500K posts), 3 nicho específico, 2 de marca. Devuelve como string separado por espacios.",
    expectsList: false
  },
  variants: {
    label: "3 variantes",
    emoji: "🔀",
    systemAddendum:
      "Devuelve 3 variantes del copy con enfoques distintos: educativo, emocional y urgencia. Cada variante separada por '---'.",
    expectsList: true
  },
  translate_en: {
    label: "Traducir a inglés",
    emoji: "🌐",
    systemAddendum: "Traduce el copy al inglés natural, no literal. Mantén tono y CTA."
  },
  custom: {
    label: "Instrucción libre",
    emoji: "✨",
    systemAddendum: ""
  }
};

export async function runAiAction(opts: {
  workspaceId: string;
  userId?: string | null;
  postId: string;
  action: AiAction;
  customInstruction?: string;
}): Promise<{ result: string; variants?: string[]; postSnapshot: any }> {
  const post = await prisma.editorialPost.findFirst({
    where: { id: opts.postId, workspaceId: opts.workspaceId },
    include: { client: true }
  });
  if (!post) throw new Error("Publicación no encontrada");

  const def = AI_ACTIONS[opts.action];
  if (!def) throw new Error("Acción no válida");

  const client = post.client;
  const briefBlock = client?.brandBrief?.trim()
    ? `## Brief del cliente "${client.name}"\n${client.brandBrief}\n`
    : "";
  const guideBlock = client?.styleGuideCached?.trim()
    ? `## Guía de estilo\n${client.styleGuideCached}\n`
    : "";

  const system = [
    `Eres un copywriter senior de la agencia que ajusta copys de redes sociales.`,
    briefBlock,
    guideBlock,
    `## Acción a realizar`,
    def.systemAddendum,
    opts.customInstruction ? `## Instrucción extra del usuario\n${opts.customInstruction}` : "",
    `Devuelve SOLO el copy resultante, sin preámbulos ni explicaciones.`,
    opts.action === "variants" ? `Las 3 variantes separadas literalmente por '---' en su propia línea.` : "",
    opts.action === "hashtags" ? `Sólo los hashtags en una sola línea, separados por espacios.` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const user = `## Copy actual\n${post.content ?? ""}\n\n## Hashtags actuales\n${post.hashtags ?? "(ninguno)"}`;

  const text = await complete({
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? null,
    feature: `editorial_ai_${opts.action}`,
    system,
    user,
    maxTokens: 2000
  });

  let variants: string[] | undefined;
  if (opts.action === "variants") {
    variants = text
      .split(/\n?---+\n?/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return { result: text.trim(), variants, postSnapshot: { id: post.id, content: post.content } };
}
