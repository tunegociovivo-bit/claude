import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic-client";
import { prisma } from "@/lib/prisma";
import { classifyReplyOutcome, type ReplyOutcome } from "@/lib/inbox/text";
import {
  buildLearningPrompt,
  learningStats,
  selectLearningExamples,
  shouldRefreshStyleGuide,
} from "@/lib/inbox/learning-core";
import { getWorkspaceSettings } from "@/lib/settings";

const LEARNING_MODEL = () => process.env.SONIA_LEARNING_MODEL || "claude-haiku-4-5-20251001";

// Lo que el cliente escribió desde nuestra última respuesta (contexto del ejemplo).
async function customerTextBefore(workspaceId: string, phone: string, before: Date): Promise<string> {
  const recent = await prisma.message.findMany({
    where: { workspaceId, phone, createdAt: { lt: before } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { direction: true, body: true },
  });
  const inbound: string[] = [];
  for (const m of recent) {
    if (m.direction !== "in") break;
    inbound.unshift(m.body);
  }
  return inbound.slice(-3).join("\n").slice(0, 800);
}

// Registra una respuesta escrita por una persona (desde el CRM o desde el móvil).
export async function recordHumanReply(opts: {
  workspaceId: string;
  lineId: string | null;
  phone: string;
  finalText: string;
  aiDraft: string | null;
  source: "crm" | "phone";
  at: Date;
}) {
  const customerText = await customerTextBefore(opts.workspaceId, opts.phone, opts.at);
  if (!customerText.trim()) return null; // no era una respuesta: no enseña estilo de respuesta
  let outcome: ReplyOutcome;
  let similarityScore: number | null = null;
  if (opts.source === "phone") {
    outcome = "phone";
  } else {
    const result = classifyReplyOutcome(opts.aiDraft, opts.finalText);
    outcome = result.outcome;
    similarityScore = result.similarity;
  }
  const row = await prisma.replyLearning.create({
    data: {
      workspaceId: opts.workspaceId,
      lineId: opts.lineId,
      phone: opts.phone,
      customerText,
      aiDraft: opts.aiDraft,
      finalText: opts.finalText.slice(0, 4000),
      outcome,
      similarity: similarityScore,
    },
  });
  const learning = await prisma.inboxLearning.upsert({
    where: { workspaceId: opts.workspaceId },
    create: { workspaceId: opts.workspaceId, pendingSamples: outcome === "accepted" ? 0 : 1 },
    update: outcome === "accepted" ? {} : { pendingSamples: { increment: 1 } },
  });
  if (shouldRefreshStyleGuide(learning)) void refreshStyleGuide(opts.workspaceId).catch(() => undefined);
  return row;
}

export async function learningPromptFor(opts: {
  workspaceId: string;
  phone: string;
  lineId: string | null;
  currentText: string;
}): Promise<string> {
  const [learning, rows] = await Promise.all([
    prisma.inboxLearning.findUnique({ where: { workspaceId: opts.workspaceId }, select: { styleGuide: true } }),
    prisma.replyLearning.findMany({
      where: { workspaceId: opts.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 400,
    }),
  ]);
  const examples = selectLearningExamples(
    rows,
    { text: opts.currentText, phone: opts.phone, lineId: opts.lineId },
    new Date()
  );
  return buildLearningPrompt({ styleGuide: learning?.styleGuide ?? "", examples });
}

const refreshing = new Set<string>();

// Destila una guía de estilo breve a partir de las últimas respuestas humanas.
export async function refreshStyleGuide(workspaceId: string, opts: { force?: boolean } = {}) {
  if (refreshing.has(workspaceId)) return null;
  refreshing.add(workspaceId);
  try {
    const learning = await prisma.inboxLearning.findUnique({ where: { workspaceId } });
    if (learning?.locked && !opts.force) return null;
    const rows = await prisma.replyLearning.findMany({
      where: { workspaceId, outcome: { in: ["edited", "rewritten", "written", "phone"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (rows.length < 3) return null;
    const settings = await getWorkspaceSettings(workspaceId);
    const samples = rows
      .map((r, i) => {
        const draft = r.aiDraft ? `\n   Propuesta IA: ${r.aiDraft.slice(0, 400)}` : "";
        return `${i + 1}. Cliente: ${r.customerText.slice(0, 300)}${draft}\n   Enviado por el equipo: ${r.finalText.slice(0, 500)}`;
      })
      .join("\n");
    const anthropic = await getAnthropicForWorkspace(workspaceId, { timeout: 40_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: LEARNING_MODEL(),
      max_tokens: 700,
      system:
        "Eres un analista de atención al cliente. Extraes reglas de estilo concretas y accionables a partir de respuestas reales de WhatsApp de un negocio. Respondes solo con viñetas en español, sin introducción.",
      messages: [
        {
          role: "user",
          content: `Negocio: ${settings.sonia.businessName || "(sin nombre)"}.\n${
            learning?.styleGuide ? `Guía actual (mejórala, no la pierdas):\n${learning.styleGuide}\n\n` : ""
          }Estas son respuestas reales del equipo (algunas corrigen una propuesta de la IA):\n${samples}\n\nEscribe una guía de estilo de 6 a 12 viñetas («- …») sobre: tuteo o usted, longitud, saludo y despedida, firma, uso de emojis, cómo proponen citas o precios, cómo cierran la conversación y qué corrigen de la IA. Sé concreto. No incluyas nombres, teléfonos ni datos de clientes.`,
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim()
      .slice(0, 4000);
    if (!text) return null;
    return prisma.inboxLearning.upsert({
      where: { workspaceId },
      create: { workspaceId, styleGuide: text, pendingSamples: 0, refreshedAt: new Date() },
      update: { styleGuide: text, pendingSamples: 0, refreshedAt: new Date(), ...(opts.force ? { locked: false } : {}) },
    });
  } finally {
    refreshing.delete(workspaceId);
  }
}

export async function learningOverview(workspaceId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [learning, rows, recent] = await Promise.all([
    prisma.inboxLearning.findUnique({ where: { workspaceId } }),
    prisma.replyLearning.findMany({ where: { workspaceId, createdAt: { gte: since } }, select: { outcome: true } }),
    prisma.replyLearning.findMany({
      where: { workspaceId, outcome: { in: ["edited", "rewritten"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, customerText: true, aiDraft: true, finalText: true, outcome: true, createdAt: true },
    }),
  ]);
  return {
    styleGuide: learning?.styleGuide ?? "",
    locked: learning?.locked ?? false,
    refreshedAt: learning?.refreshedAt ?? null,
    pendingSamples: learning?.pendingSamples ?? 0,
    stats: learningStats(rows),
    recentCorrections: recent,
  };
}
