"use client";

/**
 * Panel de autonomía de Sonia (admin). Consume los endpoints reales:
 *   - GET  /api/v1/ai/providers   → motor live/shadow, salud/coste/breaker por proveedor.
 *   - GET  /api/v1/ai/learning    → aprendizaje (éxitos/fallos verificados, estrategias).
 *   - POST /api/v1/ai/orchestrations/enqueue → canary A0/A1 (proveedor preferido/forzado).
 *   - GET  /api/v1/ai/orchestrations/{id}    → seguimiento del run encolado.
 * Estados de carga / vacío / error. No ejecuta efectos externos (solo A0/A1).
 */
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Activity, RefreshCw, Zap, ShieldAlert, Brain, PlayCircle } from "lucide-react";

type Provider = {
  provider: string; model: string; capabilities: string[];
  costPer1kUsd: { input: number; output: number } | null; healthy: boolean;
  breaker: { state: string; failureCount: number; probeLive: boolean };
};
type ProvidersResp = { engine: { live: boolean; mode: string; multiModel: boolean }; providers: Provider[] };
type Learning = { summary: { strategies: number; verifiedSuccesses: number; verifiedFailures: number }; learned: any[] };

const euro = (n: number) => `$${n.toFixed(4)}`;

export default function SoniaAutonomiaPage() {
  const [prov, setProv] = useState<ProvidersResp | null>(null);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [p, l] = await Promise.all([fetch("/api/v1/ai/providers"), fetch("/api/v1/ai/learning")]);
      if (p.status === 404 || l.status === 404) { setErr("El orquestador está desactivado (AI_RUN_ORCHESTRATOR=off)."); setProv(null); setLearning(null); return; }
      if (!p.ok) throw new Error(`providers ${p.status}`);
      setProv(await p.json());
      setLearning(l.ok ? await l.json() : null);
    } catch (e: any) {
      setErr(String(e?.message ?? "error de carga"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Autonomía de Sonia" description="Salud del multimodelo, aprendizaje y canary controlado (A0/A1)." />

      <div className="flex items-center gap-2 mb-4">
        <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white text-sm hover:bg-slate-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
        {prov && (
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${prov.engine.live ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            <Activity className="h-3.5 w-3.5" /> Motor: {prov.engine.live ? "LIVE" : `SHADOW (${prov.engine.mode})`}
          </span>
        )}
      </div>

      {err && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 mb-6 text-sm flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> {err}</div>}
      {loading && !prov && <div className="bg-white rounded-xl border p-6 text-sm text-slate-500">Cargando…</div>}

      {prov && (
        <section className="bg-white rounded-xl border overflow-hidden mb-6">
          <div className="p-5 border-b flex items-center gap-2"><Zap className="h-4 w-4 text-slate-400" /><h2 className="font-semibold">Proveedores · salud / coste / circuit breaker</h2></div>
          {prov.providers.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No hay slots de modelo configurados.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 bg-slate-50"><tr>
                  <th className="text-left p-3">Proveedor</th><th className="text-left p-3">Modelo</th>
                  <th className="text-left p-3">Salud</th><th className="text-left p-3">Breaker</th><th className="text-right p-3">Coste/1k (in/out)</th>
                </tr></thead>
                <tbody className="divide-y">
                  {prov.providers.map((p) => (
                    <tr key={p.provider + p.model}>
                      <td className="p-3 font-medium">{p.provider}</td>
                      <td className="p-3 text-slate-600 font-mono text-xs">{p.model}</td>
                      <td className="p-3">{p.healthy ? <span className="text-emerald-600">● disponible</span> : <span className="text-slate-400">○ sin clave</span>}</td>
                      <td className="p-3">
                        <span className={p.breaker.state === "closed" ? "text-emerald-600" : p.breaker.state === "open" ? "text-red-600" : "text-amber-600"}>
                          {p.breaker.state}{p.breaker.failureCount ? ` (${p.breaker.failureCount})` : ""}
                        </span>
                      </td>
                      <td className="p-3 text-right text-slate-600">{p.costPer1kUsd ? `${euro(p.costPer1kUsd.input)} / ${euro(p.costPer1kUsd.output)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {learning && (
        <section className="bg-white rounded-xl border p-5 mb-6">
          <div className="flex items-center gap-2 mb-3"><Brain className="h-4 w-4 text-slate-400" /><h2 className="font-semibold">Aprendizaje durable</h2></div>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Estrategias" value={learning.summary.strategies} />
            <Stat label="Éxitos verificados" value={learning.summary.verifiedSuccesses} tone="ok" />
            <Stat label="Fallos verificados" value={learning.summary.verifiedFailures} tone="warn" />
          </div>
          {learning.summary.strategies === 0 && <p className="text-xs text-slate-500 mt-3">Aún no hay estrategias aprendidas. Se registran cuando un run se resuelve con verificación objetiva (live).</p>}
        </section>
      )}

      <CanaryForm providers={prov?.providers ?? []} disabled={!prov?.engine.live} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-slate-800";
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function CanaryForm({ providers, disabled }: { providers: Provider[]; disabled: boolean }) {
  const [objective, setObjective] = useState("Resume en 5 líneas el estado del negocio este mes.");
  const [keyPoints, setKeyPoints] = useState("ingresos, gastos");
  const [routing, setRouting] = useState<"auto" | "prefer" | "force">("auto");
  const [provider, setProvider] = useState("openai");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setBusy(true); setError(null); setResult(null);
    const body: any = {
      taskId: `panel-canary-${Date.now()}`,
      autonomy: "A1",
      taskType: "resumen",
      objective,
      verification: { mustCoverKeyPoints: keyPoints.split(",").map((s) => s.trim()).filter(Boolean) }
    };
    if (routing === "force") body.forceProvider = provider;
    if (routing === "prefer") body.preferProvider = provider;
    const r = await fetch("/api/v1/ai/orchestrations/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(data?.error?.message ?? `Error ${r.status}`); return; }
    setResult(data);
  }

  return (
    <section className="bg-white rounded-xl border p-5">
      <div className="flex items-center gap-2 mb-3"><PlayCircle className="h-4 w-4 text-slate-400" /><h2 className="font-semibold">Canary controlado (A0/A1 · sin efectos externos)</h2></div>
      {disabled && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">El motor no está en LIVE — el canary responderá 409 hasta activar AI_RUN_ORCHESTRATOR=live y AI_MULTIMODEL=on.</div>}
      <label className="block text-xs text-slate-500 mb-1">Objetivo (interno)</label>
      <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border text-sm mb-3" />
      <label className="block text-xs text-slate-500 mb-1">Puntos clave a cubrir (coma-separados)</label>
      <input value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm mb-3" />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select value={routing} onChange={(e) => setRouting(e.target.value as any)} className="px-3 py-2 rounded-lg border text-sm">
          <option value="auto">Routing automático</option>
          <option value="prefer">Preferir proveedor (permite failover)</option>
          <option value="force">Forzar proveedor (excluye a los demás)</option>
        </select>
        {routing !== "auto" && (
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="px-3 py-2 rounded-lg border text-sm">
            {[...new Set(providers.map((p) => p.provider))].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <button onClick={launch} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Encolando…" : "Encolar canary"}
        </button>
      </div>
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
      {result && (
        <div className="text-xs bg-slate-50 border rounded-lg p-3 font-mono break-all">
          id={result.id} · estado={result.state} · modo={result.mode} · verificador={result.verifierType}
          <div className="mt-1 text-slate-500">Sigue el progreso en /admin/sonia-run/{result.id} o GET /api/v1/ai/orchestrations/{result.id}</div>
        </div>
      )}
    </section>
  );
}
