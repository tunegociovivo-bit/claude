/**
 * Cola de ACCIONES por ficha (piloto automático).
 *  GET  → acciones (abiertas primero, por prioridad) + resumen por estado.
 *  POST → genera oportunidades por REGLAS (deduplicadas contra las abiertas); si `useAiCouncil` y
 *         `consent`, además consulta el AI Council (multimodelo) y añade sus propuestas de consenso.
 * Tenant-scoped. Acciones externas nacen con requiresApproval=true.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { computePresenceScore } from "@/lib/gmb/presence-score";
import { computeActionPriority, OPEN_ACTION_STATUSES } from "@/lib/gmb/actions";
import { ensureGmbClient, gatherPresenceInput, citationStats, buildRuleOpportunities } from "@/lib/gmb/server";
import { runAiCouncil } from "@/lib/gmb/ai-council";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const actions = await prisma.gmbAction.findMany({
    where: { workspaceId: api.workspaceId, clientId: client.id },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 200
  });
  const byStatus: Record<string, number> = {};
  for (const a of actions) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  const open = actions.filter((a) => OPEN_ACTION_STATUSES.includes(a.status as any)).length;
  return NextResponse.json({ ok: true, actions, summary: { total: actions.length, open, byStatus }, autopilotMode: client.autopilotMode });
});

const postSchema = z.object({ useAiCouncil: z.boolean().default(false), consent: z.boolean().default(false) });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const input = await gatherPresenceInput(prisma, api.workspaceId, client);
  const score = computePresenceScore(input);
  const cites = await citationStats(prisma, api.workspaceId, client.id);
  const opportunities = buildRuleOpportunities(input, score.breakdown, cites);

  // Dedup: no dupliques un tipo que ya tiene una acción ABIERTA.
  const openActions = await prisma.gmbAction.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id, status: { in: OPEN_ACTION_STATUSES } }, select: { type: true } });
  const openTypes = new Set(openActions.map((a) => a.type));

  let created = 0;
  for (const o of opportunities) {
    if (openTypes.has(o.type)) continue;
    await prisma.gmbAction.create({
      data: {
        workspaceId: api.workspaceId, clientId: client.id, module: o.module, type: o.type, title: o.title, description: o.description,
        impact: o.impact, effort: o.effort, confidence: o.confidence, priority: o.priority, evidence: o.evidence,
        status: "suggested", requiresApproval: o.requiresApproval, external: o.external, source: "rule", createdById: api.userId ?? null
      }
    });
    openTypes.add(o.type);
    created++;
  }

  // AI Council (opcional): solo con consentimiento explícito y datos NO PII (categoría + señales).
  let council: any = { status: "skipped" };
  if (parsed.data.useAiCouncil) {
    const wsKeys = await workspaceModelKeys(api.workspaceId).catch(() => ({}));
    const system = "Eres un consultor de SEO local. Propón acciones de crecimiento para una ficha de Google Business. Devuelve SOLO JSON {\"proposals\":[{\"title\",\"description\",\"impact\":0-100,\"effort\":0-100,\"confidence\":0-100,\"rationale\"}]}. No inventes datos.";
    const user = JSON.stringify({ categoria: client.category, ciudad: client.address ? String(client.address).split(",").pop()?.trim() : null, score: score.total, desglose: score.breakdown, senales: { reseñas: input.reviews.count, respuesta: input.reviews.responseRate, fotos: input.profile.photoCount, posts30: input.content.postsLast30, citaciones: cites } });
    const run = await runAiCouncil({ workspaceId: api.workspaceId, purpose: "opportunities", system, user, consent: parsed.data.consent, workspaceKeys: wsKeys, maxOutputTokens: 900 });
    council = { status: run.status, reason: run.reason, models: run.models, proposals: run.proposals.length, discrepancies: run.discrepancies.length, costUsd: run.costUsd };
    await prisma.gmbAiRun.create({ data: { workspaceId: api.workspaceId, clientId: client.id, purpose: "opportunities", models: run.models, consensus: run.proposals, discrepancies: run.discrepancies, promptVersion: run.promptVersion, costUsd: run.costUsd, latencyMs: run.latencyMs, status: run.status, createdById: api.userId ?? null } });
    // Añade propuestas de CONSENSO como acciones (source ai_council), sin duplicar por título.
    for (const p of run.proposals.slice(0, 6)) {
      const type = `ai_${p.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`;
      if (openTypes.has(type)) continue;
      await prisma.gmbAction.create({
        data: { workspaceId: api.workspaceId, clientId: client.id, module: "presence", type, title: p.title, description: p.description, impact: p.impact, effort: p.effort, confidence: p.confidence, priority: computeActionPriority(p), evidence: { agreement: p.agreement, providers: p.providers, rationale: p.rationale }, status: "suggested", requiresApproval: true, external: true, source: "ai_council", createdById: api.userId ?? null }
      });
      openTypes.add(type);
      created++;
    }
  }

  return NextResponse.json({ ok: true, created, council });
});

/** Claves de modelo por workspace (Ajustes cifrados) para el AI Council, si existen. */
async function workspaceModelKeys(workspaceId: string): Promise<Record<string, string>> {
  const { decryptSecret } = await import("@/lib/ai/crypto");
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const ai: any = (ws?.settings as any)?.ai ?? {};
  const out: Record<string, string> = {};
  const map: [string, string][] = [["anthropicApiKeyEnc", "ANTHROPIC_API_KEY"], ["openaiApiKeyEnc", "OPENAI_API_KEY"], ["geminiApiKeyEnc", "GEMINI_API_KEY"], ["perplexityApiKeyEnc", "PERPLEXITY_API_KEY"]];
  for (const [encKey, env] of map) if (ai[encKey]) { try { const v = decryptSecret(ai[encKey]); if (v) out[env] = v; } catch {} }
  return out;
}
