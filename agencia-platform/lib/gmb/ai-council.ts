/**
 * AI Council — consulta MULTIMODELO (Claude, Gemini, OpenAI, Perplexity) para proponer acciones de
 * crecimiento local. Reutiliza el registro de proveedores y los adaptadores LIVE reales.
 *
 * Honestidad y privacidad (requisitos duros):
 *   - Si NO hay claves para ningún proveedor → status "no_providers". JAMÁS finge que consultó.
 *   - Si NO hay consentimiento/config para enviar datos del cliente → no llama a ningún modelo.
 *   - PII se REDACTA antes de enviar (reutiliza redactPii).
 *   - Se registran modelos/latencia/coste/versión de prompt SIN secretos.
 *
 * Con varios proveedores disponibles: se ejecutan en paralelo, se normalizan las propuestas, se
 * DEDUPLICAN, se puntúan por evidencia/consenso y se exponen las DISCREPANCIAS.
 */
import { MODEL_SLOTS, slotHealth, type ModelSlot } from "@/lib/ai/orchestrator/providers";
import { completeLive } from "@/lib/ai/orchestrator/live-adapters";
import { redactPii } from "@/lib/ai/orchestrator/pii-redact";

export type CouncilProposal = { title: string; description: string; impact: number; effort: number; confidence: number; rationale: string; agreement: number; providers: string[] };
export type CouncilModelRun = { provider: string; model: string; status: "ok" | "error"; latencyMs: number; costUsd: number; error?: string };
export type CouncilStatus = "done" | "partial" | "no_providers" | "error";
export type CouncilResult = {
  status: CouncilStatus;
  reason?: string;
  models: CouncilModelRun[];
  proposals: CouncilProposal[]; // consenso (agreement>=2) primero, luego resto por prioridad
  discrepancies: CouncilProposal[]; // propuestas de un solo modelo
  costUsd: number;
  latencyMs: number;
  promptVersion: string;
};

const clampN = (n: any, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const key = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim().slice(0, 48);

function parseProposals(text: string): { title: string; description: string; impact: number; effort: number; confidence: number; rationale: string }[] {
  if (!text) return [];
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let obj: any;
  try { obj = JSON.parse(cleaned.slice(start, end + 1)); } catch { return []; }
  const arr = Array.isArray(obj?.proposals) ? obj.proposals : [];
  return arr
    .filter((p: any) => p && typeof p.title === "string" && p.title.trim())
    .map((p: any) => ({
      title: String(p.title).trim().slice(0, 120),
      description: String(p.description ?? "").slice(0, 600),
      impact: clampN(p.impact),
      effort: clampN(p.effort),
      confidence: clampN(p.confidence),
      rationale: String(p.rationale ?? "").slice(0, 400)
    }));
}

export type CouncilDeps = { complete?: typeof completeLive; now?: () => number; signal?: () => AbortSignal };

/**
 * Ejecuta el consejo. `consent` DEBE ser true para enviar cualquier dato; si es false, no se llama a
 * ningún modelo (status no_providers, reason "sin_consentimiento").
 */
export async function runAiCouncil(opts: {
  workspaceId: string;
  purpose: string;
  system: string;
  user: string;
  consent: boolean;
  env?: NodeJS.ProcessEnv;
  workspaceKeys?: Record<string, string>;
  promptVersion?: string;
  maxOutputTokens?: number;
}, deps: CouncilDeps = {}): Promise<CouncilResult> {
  const env = opts.env ?? process.env;
  const promptVersion = opts.promptVersion ?? "v1";
  const empty = (status: CouncilStatus, reason?: string): CouncilResult => ({ status, reason, models: [], proposals: [], discrepancies: [], costUsd: 0, latencyMs: 0, promptVersion });

  if (!opts.consent) return empty("no_providers", "sin_consentimiento");
  const slots = MODEL_SLOTS.filter((s) => slotHealth(s, env) === "available" || (opts.workspaceKeys && opts.workspaceKeys[s.apiKeyEnv]));
  // Dedup por proveedor: un slot por proveedor (evita duplicar Anthropic opus+sonnet en el consejo).
  const byProvider = new Map<string, ModelSlot>();
  for (const s of slots) if (!byProvider.has(s.provider)) byProvider.set(s.provider, s);
  const chosen = [...byProvider.values()];
  if (chosen.length === 0) return empty("no_providers", "sin_claves");

  // PII fuera antes de enviar (canal influenciable).
  const system = redactPii(opts.system).text;
  const user = redactPii(opts.user).text;
  const complete = deps.complete ?? completeLive;
  const now = deps.now ?? (() => Date.now());

  const runs = await Promise.all(chosen.map(async (slot): Promise<{ run: CouncilModelRun; proposals: ReturnType<typeof parseProposals> }> => {
    const t0 = now();
    try {
      const signal = deps.signal ? deps.signal() : AbortSignal.timeout(45_000);
      const res = await complete(slot, { system, messages: [{ role: "user", content: user }], maxOutputTokens: opts.maxOutputTokens ?? 900 }, { keySources: { env, workspaceKeys: opts.workspaceKeys }, signal, maxOutputTokens: opts.maxOutputTokens ?? 900 }, {});
      return { run: { provider: slot.provider, model: slot.model, status: "ok", latencyMs: now() - t0, costUsd: res.usage.costUsd }, proposals: parseProposals(res.text) };
    } catch (e: any) {
      return { run: { provider: slot.provider, model: slot.model, status: "error", latencyMs: now() - t0, costUsd: 0, error: String(e?.name ?? e?.message ?? "error").slice(0, 120) }, proposals: [] };
    }
  }));

  const models = runs.map((r) => r.run);
  const okRuns = runs.filter((r) => r.run.status === "ok");
  const costUsd = Math.round(models.reduce((s, m) => s + m.costUsd, 0) * 1e6) / 1e6;
  const latencyMs = Math.max(0, ...models.map((m) => m.latencyMs));

  if (okRuns.length === 0) return { ...empty("error", "todos_los_modelos_fallaron"), models, costUsd, latencyMs };

  // Normaliza + deduplica por título; agreement = nº de proveedores distintos que la proponen.
  const groups = new Map<string, { p: CouncilProposal }>();
  for (const r of okRuns) {
    for (const prop of r.proposals) {
      const k = key(prop.title);
      if (!k) continue;
      const existing = groups.get(k);
      if (existing) {
        if (!existing.p.providers.includes(r.run.provider)) existing.p.providers.push(r.run.provider);
        existing.p.agreement = existing.p.providers.length;
        // Promedia impacto/esfuerzo/confianza entre modelos que coinciden.
        existing.p.impact = Math.round((existing.p.impact + prop.impact) / 2);
        existing.p.effort = Math.round((existing.p.effort + prop.effort) / 2);
        existing.p.confidence = Math.round((existing.p.confidence + prop.confidence) / 2);
      } else {
        groups.set(k, { p: { ...prop, agreement: 1, providers: [r.run.provider] } });
      }
    }
  }
  const all = [...groups.values()].map((g) => g.p);
  const rank = (p: CouncilProposal) => p.agreement * 1000 + (p.impact * p.confidence) / Math.max(1, p.effort);
  all.sort((a, b) => rank(b) - rank(a));
  const proposals = all.filter((p) => p.agreement >= 2);
  const discrepancies = all.filter((p) => p.agreement < 2);
  // Si algún modelo falló pero otros respondieron → partial.
  const status: CouncilStatus = okRuns.length < chosen.length ? "partial" : "done";
  // Cuando no hay consenso (todas single-model), devolvemos las mejores como proposals igualmente.
  return { status, models, proposals: proposals.length ? proposals : all.slice(0, 5), discrepancies, costUsd, latencyMs, promptVersion };
}
