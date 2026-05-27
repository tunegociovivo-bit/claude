"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Sparkles, Key, Check, Trash2, ExternalLink, Loader2 } from "lucide-react";

type Status = { hasKey: boolean; keyMasked: string | null; envKey: boolean };

export default function AISettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/v1/admin/ai-settings");
    if (r.ok) setStatus(await r.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/ai-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropicApiKey: token })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? "Error");
      }
      setToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("¿Quitar el API key guardado?")) return;
    setBusy(true);
    await fetch("/api/v1/admin/ai-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: null })
    });
    setBusy(false);
    load();
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Configuración de IA"
        description="Conecta tu cuenta de Anthropic para habilitar las funciones de IA en toda la plataforma."
      />

      <div className="bg-white rounded-xl border p-6 mb-4">
        <h2 className="font-semibold mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" />
          API key de Anthropic
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Obtén una desde{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-brand-600 underline inline-flex items-center gap-1"
          >
            console.anthropic.com/settings/keys <ExternalLink className="h-3 w-3" />
          </a>
          . Se cifra antes de guardarse en la base de datos (AES-256-GCM).
        </p>

        {status?.hasKey ? (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <Check className="h-4 w-4" />
              Conectado: <code className="font-mono">{status.keyMasked}</code>
            </div>
            <button
              onClick={remove}
              disabled={busy}
              className="text-xs text-rose-600 hover:text-rose-700 inline-flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" />
              Quitar
            </button>
          </div>
        ) : status?.envKey ? (
          <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-900 mb-4">
            La variable de entorno <code>ANTHROPIC_API_KEY</code> está activa y se usará como fallback. Puedes
            sobreescribirla aquí para usar otra cuenta sólo para este workspace.
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 mb-4">
            Aún no hay API key configurada. Las funciones de IA están desactivadas.
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Key className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="password"
              placeholder="sk-ant-…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <button
            onClick={save}
            disabled={busy || !token.trim()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
          </button>
        </div>
        {saved && <p className="text-xs text-emerald-600 mt-2">Guardado.</p>}
        {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      </div>

      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold mb-3">Qué desbloquea</h2>
        <ul className="space-y-2 text-sm text-slate-700">
          <li className="flex gap-2">
            <Sparkles className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
            <span>
              <strong>Asistente Hub</strong> — chat flotante con acceso a clientes, tareas, proyectos,
              documentos y calendario vía tool use.
            </span>
          </li>
          <li className="flex gap-2">
            <Sparkles className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
            <span>
              <strong>Resumen y edición de documentos</strong> — botón IA dentro de cada documento.
            </span>
          </li>
          <li className="flex gap-2">
            <Sparkles className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
            <span>
              <strong>Redactor de copys</strong> en <code>/admin/redactor</code> — genera copy listo para Instagram, blog, email, ads, etc.
            </span>
          </li>
          <li className="flex gap-2">
            <Sparkles className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
            <span>
              <strong>Sugerencias automáticas de tags</strong> en las tareas.
            </span>
          </li>
        </ul>
        <p className="text-xs text-slate-500 mt-4">
          Modelo por defecto: <code>claude-opus-4-7</code> con adaptive thinking y prompt caching del
          contexto del workspace.
        </p>
      </div>
    </div>
  );
}
