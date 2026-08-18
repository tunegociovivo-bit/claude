/**
 * AI Council por ficha (multimodelo, honesto).
 *  GET  → estado de conexión (qué proveedores tienen clave) + últimas ejecuciones (sin secretos).
 *  POST → ejecuta el consejo para un propósito con consentimiento explícito; registra la ejecución.
 * Nunca finge consultar un modelo: sin claves/consentimiento → status no_providers.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient, gatherPresenceInput, citationStats } from "@/lib/gmb/server";
import { computePresenceScore } from "@/lib/gmb/presence-score";
import { runAiCouncil } from "@/lib/gmb/ai-council";
import { MODEL_SLOTS, slotHealth } from "@/lib/ai/orchestrator/providers";
import { decryptSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

async function workspaceModelKeys(workspaceId: string): Promise<Record<string, string>> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const ai: any = (ws?.settings as any)?.ai ?? {};
  const out: Record<string, string> = {};
  for (const [encKey, env] of [["anthropicApiKeyEnc", "ANTHROPIC_API_KEY"], ["openaiApiKeyEnc", "OPENAI_API_KEY"], ["geminiApiKeyEnc", "GEMINI_API_KEY"], ["perplexityApiKeyEnc", "PERPLEXITY_API_KEY"]] as [string, string][]) {
    if (ai[encKey]) { try { const v = decryptSecret(ai[encKey]); if (v) out[env] = v; } catch {} }
  }
  return out;
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const wsKeys: Record<string, string> = await workspaceModelKeys(api.workspaceId).catch(() => ({}));
  const providers = [...new Map(MODEL_SLOTS.map((s) => [s.provider, s])).values()].map((s) => ({
    provider: s.provider,
    connected: slotHealth(s) === "available" || !!wsKeys[s.apiKeyEnv]
  }));
  const runs = await prisma.gmbAiRun.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, purpose: true, models: true, status: true, costUsd: true, latencyMs: true, promptVersion: true, createdAt: true } });
  return NextResponse.json({ ok: true, providers, connectedCount: providers.filter((p) => p.connected).length, runs });
});

const postSchema = z.object({ purpose: z.enum(["opportunities", "content_ideas"]).default("opportunities"), consent: z.boolean().default(false) });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const input = await gatherPresenceInput(prisma, api.workspaceId, client);
  const score = computePresenceScore(input);
  const cites = await citationStats(prisma, api.workspaceId, client.id);
  const wsKeys = await workspaceModelKeys(api.workspaceId).catch(() => ({}));

  const system = parsed.data.purpose === "content_ideas"
    ? "Eres un experto en contenido para Google Business Profile. Propón ideas de publicaciones (novedades/ofertas/eventos). Devuelve SOLO JSON {\"proposals\":[{\"title\",\"description\",\"impact\":0-100,\"effort\":0-100,\"confidence\":0-100,\"rationale\"}]}."
    : "Eres un consultor de SEO local. Propón acciones de crecimiento para una ficha de Google Business. Devuelve SOLO JSON {\"proposals\":[{\"title\",\"description\",\"impact\":0-100,\"effort\":0-100,\"confidence\":0-100,\"rationale\"}]}. No inventes datos.";
  const user = JSON.stringify({ categoria: client.category, score: score.total, desglose: score.breakdown, senales: { reseñas: input.reviews.count, respuesta: input.reviews.responseRate, fotos: input.profile.photoCount, posts30: input.content.postsLast30, citaciones: cites } });

  const run = await runAiCouncil({ workspaceId: api.workspaceId, purpose: parsed.data.purpose, system, user, consent: parsed.data.consent, workspaceKeys: wsKeys, maxOutputTokens: 900 });
  await prisma.gmbAiRun.create({ data: { workspaceId: api.workspaceId, clientId: client.id, purpose: parsed.data.purpose, models: run.models, consensus: run.proposals, discrepancies: run.discrepancies, promptVersion: run.promptVersion, costUsd: run.costUsd, latencyMs: run.latencyMs, status: run.status, createdById: api.userId ?? null } });
  return NextResponse.json({ ok: true, run });
});
