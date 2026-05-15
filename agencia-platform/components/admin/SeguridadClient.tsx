"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, Download, Shield, CheckCircle2, XCircle, Clock, AlertTriangle, HardDrive, Cloud, Key, Eye, EyeOff, Copy as CopyIcon, ExternalLink } from "lucide-react";

type BackupRun = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  trigger: string;
  destinations: string;
  sizeBytes: number | null;
  downloadKey: string | null;
  errorMessage: string | null;
};

function formatBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function SeguridadClient() {
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [storageEnabled, setStorageEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/admin/backups");
    if (r.ok) {
      const d = await r.json();
      setRuns(d.items ?? []);
      setStorageEnabled(d.storageEnabled);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function runBackup() {
    setRunning(true);
    setError(null);
    const r = await fetch("/api/v1/admin/backups", { method: "POST" });
    setRunning(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    load();
  }

  const lastSuccess = runs.find((r) => r.status === "COMPLETED");

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Seguridad y copias de seguridad"
        description="Genera copias de seguridad bajo demanda o consulta el histórico de los backups automáticos diarios."
        actions={
          <button
            onClick={runBackup}
            disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            Hacer copia de seguridad ahora
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Card
          icon={<Clock className="h-4 w-4 text-brand-600" />}
          label="Última copia exitosa"
          value={lastSuccess ? formatDate(lastSuccess.completedAt) : "Aún ninguna"}
        />
        <Card
          icon={<HardDrive className="h-4 w-4 text-emerald-600" />}
          label="Total copias guardadas"
          value={String(runs.filter((r) => r.status === "COMPLETED").length)}
        />
        <Card
          icon={<Cloud className={storageEnabled ? "h-4 w-4 text-emerald-600" : "h-4 w-4 text-amber-600"} />}
          label="Destino remoto (R2)"
          value={storageEnabled ? "Cloudflare R2 activo" : "Solo descarga local"}
        />
      </div>

      <div className="bg-white rounded-xl border p-5 mb-4">
        <h2 className="text-sm font-semibold mb-2">Destinos de la copia</h2>
        <ul className="text-sm space-y-2">
          <li className="flex items-start gap-2">
            <HardDrive className="h-4 w-4 text-slate-500 mt-0.5" />
            <div>
              <strong>Disco duro local (descarga manual)</strong> — Pulsa "Descargar" en cualquier copia del histórico para bajarla a tu equipo.
            </div>
          </li>
          <li className="flex items-start gap-2">
            {storageEnabled ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 text-slate-400 mt-0.5" />
            )}
            <div>
              <strong>Cloudflare R2 (remoto)</strong> — {storageEnabled
                ? "Cada copia se sube automáticamente a R2. Coste casi cero."
                : "Sin configurar. Añade las variables STORAGE_* (ver docs/STORAGE_SETUP.md) para guardar copias en R2."}
            </div>
          </li>
          <li className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-slate-400 mt-0.5" />
            <div>
              <strong>Google Drive</strong> — Pendiente. Requiere OAuth con cuenta de servicio; lo añadimos en próximo PR cuando configures Drive.
            </div>
          </li>
          <li className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-slate-400 mt-0.5" />
            <div>
              <strong>VPS (Hetzner)</strong> — Pendiente. Lo activaremos cuando rotemos las credenciales SSH del VPS.
            </div>
          </li>
        </ul>
      </div>

      <div className="bg-white rounded-xl border p-5 mb-4">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Backup automático diario
        </h2>
        <p className="text-sm text-slate-600">
          Para activar el backup diario automático, configura el GitHub Action <code>backup-daily.yml</code> con los mismos secrets que el cron de recordatorios (<code>INTERNAL_CRON_TOKEN</code> y <code>HUB_BASE_URL</code>). Está documentado en <a className="underline" href="/docs/REMINDERS_SETUP.md">REMINDERS_SETUP.md</a>.
        </p>
      </div>

      <div className="bg-white rounded-xl border overflow-x-auto">
        <div className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">Histórico</h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : runs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Aún no hay copias. Pulsa <strong>"Hacer copia de seguridad ahora"</strong> arriba para crear la primera.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3">Inicio</th>
                <th className="text-left px-3 py-3">Estado</th>
                <th className="text-left px-3 py-3">Disparo</th>
                <th className="text-left px-3 py-3">Tamaño</th>
                <th className="text-left px-3 py-3">Destino</th>
                <th className="text-right px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-xs">{formatDate(r.startedAt)}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={r.status} />
                    {r.errorMessage && (
                      <div className="text-[11px] text-rose-600 mt-0.5 truncate max-w-[260px]" title={r.errorMessage}>
                        {r.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs capitalize">{r.trigger}</td>
                  <td className="px-3 py-3 text-xs tabular-nums">{formatBytes(r.sizeBytes)}</td>
                  <td className="px-3 py-3 text-xs">{r.destinations}</td>
                  <td className="px-5 py-3 text-right">
                    {r.status === "COMPLETED" && (
                      <a
                        href={`/api/v1/admin/backups/${r.id}/download`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-brand-700 hover:bg-brand-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Descargar
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800">
          {error}
        </div>
      )}

      <CredentialsSection />
    </div>
  );
}

function CredentialsSection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/credentials")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  function toggleShow(id: string) {
    setShown((s) => ({ ...s, [id]: !s[id] }));
  }
  function copy(value: string, id: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  return (
    <section className="mt-6 bg-white rounded-xl border">
      <header className="px-5 py-4 border-b flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Key className="h-4 w-4 text-amber-600" />
            Credenciales y secretos
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Todas las API keys, tokens y webhooks configurados en este workspace.
            Cifradas en BD con AES-256-GCM (clave derivada de <code className="text-[10px]">NEXTAUTH_SECRET</code>).
            Pulsa el ojo para verlas y el botón para copiar al portapapeles.
          </p>
        </div>
        <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-medium border border-amber-200">
          Solo admins
        </span>
      </header>

      {loading && <div className="p-6 text-center text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Descifrando…</div>}

      {data && (
        <>
          <div className="divide-y">
            {Object.entries(data.credentials).map(([id, c]: [string, any]) => {
              const isShown = !!shown[id];
              const hasValue = c.value !== null && c.value !== "";
              return (
                <div key={id} className="px-5 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900">{c.label}</span>
                      <code className="text-[10px] text-slate-500">{c.key}</code>
                      {!hasValue && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">no configurado</span>
                      )}
                      {c.sensitive && hasValue && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">sensible</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Configurar en{" "}
                      <a href={c.configIn} className="text-brand-600 hover:underline">{c.configIn}</a>
                      {c.docsUrl && (
                        <>
                          {" · "}
                          <a href={c.docsUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-0.5">
                            obtenerla <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                      {c.hint && <span className="block mt-0.5 italic">{c.hint}</span>}
                    </div>
                    {hasValue && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <code className="flex-1 px-2 py-1.5 rounded border bg-slate-50 text-xs font-mono break-all">
                          {c.sensitive && !isShown
                            ? maskSecret(String(c.value))
                            : String(c.value)}
                        </code>
                        {c.sensitive && (
                          <button
                            type="button"
                            onClick={() => toggleShow(id)}
                            className="p-1.5 rounded border bg-white hover:bg-slate-50"
                            title={isShown ? "Ocultar" : "Mostrar"}
                          >
                            {isShown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => copy(String(c.value), id)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded border bg-white hover:bg-slate-50 text-xs"
                        >
                          {copiedKey === id ? "✓ Copiado" : <><CopyIcon className="h-3.5 w-3.5" /> Copiar</>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <EnvSection env={data.env} />
        </>
      )}
    </section>
  );
}

function EnvSection({ env }: { env: Record<string, any> }) {
  return (
    <details className="border-t bg-slate-50/40">
      <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-slate-700 select-none">
        🚂 Variables de entorno en Railway (informativo, no muestra valores)
      </summary>
      <div className="px-5 py-3 border-t bg-white grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        {Object.entries(env).map(([k, v]) => {
          const present = typeof v === "boolean" ? v : v !== null && v !== "";
          return (
            <div key={k} className="flex items-center justify-between gap-2">
              <code className="truncate">{k}</code>
              <span className={present ? "text-emerald-700 font-medium" : "text-slate-400"}>
                {present ? (typeof v === "string" ? v : "✓ definida") : "— no definida"}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function maskSecret(s: string): string {
  if (s.length <= 12) return "•".repeat(s.length);
  return s.slice(0, 6) + "•".repeat(Math.max(8, s.length - 12)) + s.slice(-6);
}

function Card({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</div>
      <div className="text-base font-semibold mt-1 truncate">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: BackupRun["status"] }) {
  const style: Record<typeof status, string> = {
    RUNNING: "bg-sky-100 text-sky-800 border-sky-200",
    COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-200",
    FAILED: "bg-rose-100 text-rose-800 border-rose-200"
  };
  const label: Record<typeof status, string> = {
    RUNNING: "En curso",
    COMPLETED: "Completada",
    FAILED: "Fallida"
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-md border ${style[status]}`}>
      {label[status]}
    </span>
  );
}
