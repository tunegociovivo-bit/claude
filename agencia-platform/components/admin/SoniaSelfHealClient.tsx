"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Loader2,
  ShieldCheck,
  ShieldOff,
  Save,
  Trash2,
  ExternalLink,
  Wand2
} from "lucide-react";

type Status = {
  hasToken: boolean;
  repo: string;
  branch: string;
  envFallback: boolean;
};

export default function SoniaSelfHealClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function load() {
    const r = await fetch("/api/v1/admin/self-heal-settings");
    if (r.ok) {
      const d: Status = await r.json();
      setStatus(d);
      setRepo(d.repo);
      setBranch(d.branch);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/self-heal-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, repo, branch })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setMsg({
        type: "ok",
        text: `✅ Validado contra GitHub. Repo: ${d.repoFullName} · branch ${d.branch}. Scopes: ${d.scopes}.`
      });
      setToken("");
      await load();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    if (
      !confirm(
        "¿Desactivar auto-fix? Sonia volverá al modo de antes (escala a Claude vía issue de GitHub, y necesitas que alguien lo resuelva manual)."
      )
    )
      return;
    await fetch("/api/v1/admin/self-heal-settings", { method: "DELETE" });
    setMsg(null);
    await load();
  }

  const isReady = !!status?.hasToken || !!status?.envFallback;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Auto-fix de Sonia"
        description="Cuando Sonia se topa con un bug del código, un agente Claude programático investiga el repo, abre PR con el fix y lo mergea automáticamente. Sin esperar a nadie."
      />

      {/* Estado */}
      <div
        className={
          "rounded-xl border p-4 mb-4 flex items-center justify-between gap-3 " +
          (isReady
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200")
        }
      >
        <div className="text-sm">
          {isReady ? (
            <>
              <strong className="text-emerald-800 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Auto-fix activo
              </strong>
              <div className="text-xs text-emerald-700 mt-1">
                Repo:{" "}
                <code className="bg-white px-1 rounded">{status?.repo}</code> · branch{" "}
                <code className="bg-white px-1 rounded">{status?.branch}</code>
                {status?.envFallback && " (vía env var, no UI)"}
              </div>
              <p className="text-xs text-emerald-700 mt-2 max-w-xl">
                Cuando Sonia falle por un bug del código, en ~30 segundos verás un PR
                nuevo en GitHub. Si el cambio es trivial, se mergea solo. Si no,
                queda abierta para revisión humana.
              </p>
            </>
          ) : (
            <>
              <strong className="text-amber-800 flex items-center gap-2">
                <ShieldOff className="h-4 w-4" />
                Auto-fix NO activado
              </strong>
              <p className="text-xs text-amber-700 mt-1 max-w-xl">
                Sonia sigue creando issues en GitHub cuando se atasca, pero nadie los
                procesa solo. Para autonomía completa, pega abajo un Personal Access
                Token de GitHub con scope <code>repo</code>.
              </p>
            </>
          )}
        </div>
        {status?.hasToken && (
          <button
            onClick={disable}
            className="inline-flex items-center gap-1 text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg"
          >
            <Trash2 className="h-3.5 w-3.5" /> Desactivar
          </button>
        )}
      </div>

      {/* Cómo crear el PAT */}
      <details className="bg-white border rounded-xl p-4 mb-4">
        <summary className="cursor-pointer font-semibold text-sm">
          ❓ Cómo crear el Personal Access Token (1 minuto)
        </summary>
        <ol className="mt-3 space-y-2 text-sm text-slate-700 list-decimal pl-5">
          <li>
            Abre{" "}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=Hub%20Sonia%20Self-Heal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:underline inline-flex items-center gap-0.5"
            >
              github.com/settings/tokens/new <ExternalLink className="h-3 w-3" />
            </a>{" "}
            (ya viene pre-rellenado con scope <code>repo</code> y descripción).
          </li>
          <li>
            Expiration:{" "}
            <strong>No expiration</strong> o 1 año — si lo dejas en 30d, se rota
            mucho.
          </li>
          <li>
            Verifica que <strong>scope `repo` completo</strong> está marcado.
          </li>
          <li>
            Click "Generate token" y <strong>copia el token (ghp_xxx...)</strong> —
            GitHub solo lo muestra UNA vez.
          </li>
          <li>Pégalo abajo, dale Guardar. Se valida y se cifra.</li>
        </ol>
      </details>

      {/* Form */}
      <div className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-violet-600" />
          Configuración
        </h2>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-600 block mb-1">
              GitHub Personal Access Token{" "}
              {status?.hasToken && (
                <span className="text-slate-400">(deja vacío para mantener el actual)</span>
              )}
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                Repo (owner/repo)
              </label>
              <input
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="tunegociovivo-bit/claude"
                className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                Branch principal (donde mergea)
              </label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="claude/internal-project-platform-ZezvX"
                className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={save}
              disabled={saving || (!token && !status?.hasToken)}
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white text-sm px-4 py-2 rounded-lg font-medium"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Validar y guardar
            </button>
            {!status?.hasToken && (
              <p className="text-xs text-slate-500">
                Validamos contra GitHub antes de guardar — si el token no sirve, te
                lo decimos.
              </p>
            )}
          </div>

          {msg && (
            <div
              className={
                "rounded-lg p-3 text-sm " +
                (msg.type === "ok"
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border border-rose-200 text-rose-800")
              }
            >
              {msg.text}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-500">
        💡 Cuando esto esté activo, los costes por fix son ~$0.5–$2 (Claude Opus
        leyendo el repo + proponiendo patch). Solo se dispara en errores técnicos
        reales — los errores de credenciales o saturación de Anthropic no lo
        usan.
      </div>
    </div>
  );
}
