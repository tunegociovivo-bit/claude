"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
  ExternalLink,
  Github,
  Database,
  ShieldCheck
} from "lucide-react";

type Platform = {
  key: string;
  name: string;
  role: string;
  configured: boolean;
  live?: "ok" | "fail";
  dashboard: string;
  internal?: boolean;
  credentialAt: string;
  recovery?: string;
};

type Data = {
  platforms: Platform[];
  codeBackup: { provider: string; repo: string; url: string; note: string };
  dbBackup: { lastAt: string | null; sizeBytes: number | null; manageUrl: string };
};

export default function InfraestructuraClient() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  function reload() {
    fetch("/api/v1/admin/infrastructure")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Infraestructura y backups"
        description="Todas las plataformas externas que usa el proyecto, su estado, y cómo recuperar todo si algo se rompe."
      />

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : !data ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-rose-600">
          No se pudo cargar la infraestructura.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Backups destacados */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-emerald-50/50 border-emerald-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Github className="h-5 w-5 text-emerald-700" />
                <h2 className="font-semibold text-sm text-emerald-900">Backup del código</h2>
              </div>
              <p className="text-xs text-slate-700 mb-2">{data.codeBackup.note}</p>
              <a
                href={data.codeBackup.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-900"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {data.codeBackup.repo}
              </a>
            </div>
            <div className="rounded-xl border bg-sky-50/50 border-sky-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-5 w-5 text-sky-700" />
                <h2 className="font-semibold text-sm text-sky-900">Backup de la base de datos</h2>
              </div>
              <p className="text-xs text-slate-700 mb-2">
                {data.dbBackup.lastAt
                  ? `Último backup: ${new Date(data.dbBackup.lastAt).toLocaleString("es-ES")}`
                  : "Aún no hay backups registrados."}
                {data.dbBackup.sizeBytes
                  ? ` · ${(data.dbBackup.sizeBytes / 1024 / 1024).toFixed(1)} MB`
                  : ""}
              </p>
              <Link
                href={data.dbBackup.manageUrl}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Gestionar backups (BD + Google Drive)
              </Link>
            </div>
          </div>

          {/* Tabla de plataformas */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-5 py-3 border-b bg-slate-50">
              <h2 className="font-semibold text-sm">Plataformas externas ({data.platforms.length})</h2>
            </div>
            <div className="divide-y">
              {data.platforms.map((p) => (
                <div key={p.key} className="px-5 py-4 flex items-start gap-3">
                  <div
                    className="mt-0.5 shrink-0"
                    title={
                      p.live === "fail"
                        ? "Credencial inválida"
                        : p.configured
                          ? "Configurado"
                          : "Sin configurar"
                    }
                  >
                    {p.live === "fail" ? (
                      <AlertTriangle className="h-5 w-5 text-rose-500" />
                    ) : p.configured ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <CircleDashed className="h-5 w-5 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{p.name}</span>
                      {p.live === "ok" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                          conexión OK
                        </span>
                      )}
                      {p.live === "fail" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                          revisar token
                        </span>
                      )}
                      {!p.configured && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          sin configurar
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{p.role}</p>
                    <p className="text-[11px] text-slate-400 mt-1 font-mono">{p.credentialAt}</p>
                    {p.recovery && (
                      <p className="text-[11px] text-slate-500 mt-1 italic">↻ {p.recovery}</p>
                    )}
                    {/* fal.ai: campo inline para pegar la API key sin
                        tener que abrir un post del calendario. */}
                    {p.key === "fal" && !p.configured && (
                      <FalKeyInline onSaved={reload} />
                    )}
                  </div>
                  <div className="shrink-0">
                    {p.internal ? (
                      <Link
                        href={p.dashboard}
                        className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800"
                      >
                        Configurar
                      </Link>
                    ) : (
                      <a
                        href={p.dashboard}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Panel
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Runbook de recuperación */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-sm mb-3">🛟 Si se rompe todo — cómo recuperar el proyecto</h2>
            <ol className="text-xs text-slate-700 space-y-2 list-decimal pl-5">
              <li>
                <strong>Código</strong>: está íntegro en GitHub ({data.codeBackup.repo}). Clónalo.
              </li>
              <li>
                <strong>Hosting</strong>: crea un proyecto nuevo en Railway (o cualquier host Node), conéctalo al repo.
              </li>
              <li>
                <strong>Base de datos</strong>: crea un Postgres nuevo, restaura el último dump de /admin/backups o
                Google Drive.
              </li>
              <li>
                <strong>Variables de entorno</strong>: reconfigura las env (DATABASE_URL, ANTHROPIC_API_KEY, STORAGE_*,
                CRON_SECRET, etc.). Las credenciales de integraciones (Meta, Make, fal…) viven cifradas en la BD, así
                que se restauran con el dump.
              </li>
              <li>
                <strong>Storage R2</strong>: si se perdió, los archivos generados se regeneran y los adjuntos se
                re-importan de Asana.
              </li>
              <li>
                <strong>Crons</strong>: reactiva los workflows de GitHub Actions (ya están en el repo en
                .github/workflows).
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function FalKeyInline({ onSaved }: { onSaved: () => void }) {
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!val.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/v1/admin/fal-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: val.trim() })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setVal("");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 flex gap-1.5 max-w-md">
      <input
        type="password"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Pega la FAL_KEY (id:secret)"
        className="flex-1 px-2 py-1.5 rounded-md border border-slate-300 text-[11px] font-mono"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving || !val.trim()}
        className="px-2.5 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-medium disabled:opacity-50"
      >
        {saving ? "…" : "Guardar"}
      </button>
      {err && <span className="text-[11px] text-rose-600 self-center">{err}</span>}
    </div>
  );
}
