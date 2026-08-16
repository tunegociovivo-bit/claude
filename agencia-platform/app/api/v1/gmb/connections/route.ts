/**
 * GET /api/v1/gmb/connections — estado de conexiones del workspace (GBP, Maps, Make, modelos de IA)
 * + checklist de puesta en marcha. NUNCA devuelve claves: solo flags booleanos y alcance. Tenant.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { buildConnections, buildOnboardingChecklist, connectionsSummary, type ConnectionFlags } from "@/lib/gmb/connections";
import { MODEL_SLOTS, slotHealth } from "@/lib/ai/orchestrator/providers";

export const dynamic = "force-dynamic";

async function workspaceHasModelKey(workspaceId: string): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
    const ai: any = (ws?.settings as any)?.ai ?? {};
    out.anthropic = !!ai.anthropicApiKeyEnc;
    out.openai = !!ai.openaiApiKeyEnc;
    out.gemini = !!ai.geminiApiKeyEnc;
    out.perplexity = !!ai.perplexityApiKeyEnc;
  } catch {}
  return out;
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const [gbpConn, wsKeys, maps, make] = await Promise.all([
    prisma.googleAdsConnection.findFirst({ where: { workspaceId: api.workspaceId } }).catch(() => null),
    workspaceHasModelKey(api.workspaceId),
    (async () => { try { const { getGmbMapsKey } = await import("@/lib/integrations/gmb-hub"); return !!(await getGmbMapsKey(api.workspaceId)); } catch { return false; } })(),
    (async () => { try { const { getGmbConfig } = await import("@/lib/integrations/gmb-hub"); const c = await getGmbConfig(api.workspaceId); return !!(c.replyWebhookUrl || c.ingestToken); } catch { return false; } })()
  ]);

  const envHas = (env: string) => !!process.env[env];
  const flags: ConnectionFlags = {
    gbp: !!gbpConn,
    maps,
    make,
    anthropic: envHas("ANTHROPIC_API_KEY") || !!wsKeys.anthropic,
    openai: envHas("OPENAI_API_KEY") || !!wsKeys.openai,
    gemini: envHas("GEMINI_API_KEY") || !!wsKeys.gemini,
    perplexity: envHas("PERPLEXITY_API_KEY") || !!wsKeys.perplexity
  };
  // slotHealth por si el env cambia el catálogo (defensivo, sin exponer nada).
  void MODEL_SLOTS.map((s) => slotHealth(s));

  return NextResponse.json({ ok: true, connections: buildConnections(flags), checklist: buildOnboardingChecklist(flags), summary: connectionsSummary(flags) });
});
