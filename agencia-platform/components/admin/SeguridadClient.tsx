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
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/v1/admin/backups/full-archive"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm font-medium"
              title="Descarga un ZIP con la base de datos (todas las tablas) + todos los archivos adjuntos"
            >
              <Download className="h-4 w-4" />
              Descargar copia completa (BD + adjuntos)
            </a>
            <button
              onClick={runBackup}
              disabled={running}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Hacer copia de seguridad ahora
            </button>
          </div>
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
              <strong>Disco duro local (descarga manual)</strong> — "Descargar" en cualquier copia del histórico baja solo la BD (JSON). Para llevarte <strong>todo</strong> (BD + los archivos adjuntos de R2 en un ZIP) usa el botón <strong>"Descargar copia completa"</strong> de arriba.
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
      <DriveBackupSection />
    </div>
  );
}

function DriveBackupSection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saJson, setSaJson] = useState("");
  const [folder, setFolder] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/admin/drive-backup");
    if (r.ok) {
      const d = await r.json();
      setData(d);
      if (d.folderId) setFolder(d.folderId);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setMsg(null);
    const body: any = { folder };
    if (saJson) body.serviceAccountJson = saJson;
    const r = await fetch("/api/v1/admin/drive-backup", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setSaJson("");
    setMsg("Guardado.");
    load();
  }

  async function act(action: "test" | "backup_now" | "cleanup") {
    setBusy(action);
    setError(null);
    setMsg(null);
    const body: any = { action };
    if (action === "backup_now") body.kinds = ["daily"];
    const r = await fetch("/api/v1/admin/drive-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setBusy(null);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    if (action === "test") setMsg(`✓ Conexión OK · SA ${j.serviceAccountEmail} · ${j.fileCount} archivos en la carpeta`);
    else if (action === "backup_now") {
      const ok = (j.results ?? []).filter((r: any) => r.ok).length;
      const failedItems = (j.results ?? []).filter((r: any) => !r.ok);
      if (failedItems.length > 0) {
        // Mostrar el error como error, con el mensaje real del primer fallo
        const errors = failedItems
          .map((r: any) => `${r.kind ?? "?"}: ${r.error ?? "(sin detalle)"}`)
          .join(" · ");
        setError(`Backup manual: ${ok} OK · ${failedItems.length} fallos — ${errors}`);
        setMsg(null);
      } else {
        setMsg(`✓ Backup manual: ${ok} OK · 0 fallos`);
      }
    } else if (action === "cleanup") setMsg(`✓ Limpieza: borrados ${(j.deleted ?? []).length} archivos huérfanos`);
    load();
  }

  return (
    <section className="mt-6 bg-white rounded-xl border">
      <header className="px-5 py-4 border-b">
        <h2 className="text-base font-semibold flex items-center gap-2">
          ☁️ Backups automáticos a Google Drive
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Rotación: <strong>2 diarios</strong> (hoy + ayer) ·{" "}
          <strong>2 semanales</strong> (cada lunes, máx 2 semanas) ·{" "}
          <strong>2 mensuales</strong> (día 1 del mes, máx 2 meses). Total 6 archivos.
          Diariamente a las 03:00 UTC.
        </p>
      </header>

      <div className="px-5 py-4 space-y-4">
        {loading && <div className="text-sm text-slate-500">Cargando…</div>}

        {/* Estado */}
        {data && (
          <div className={`rounded-lg border p-3 text-xs ${data.configured ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
            {data.configured ? (
              <>
                <div className="font-medium text-emerald-900">
                  ✓ Configurado
                </div>
                <div className="text-slate-700 mt-0.5">
                  Service account: <code className="text-[10px]">{data.serviceAccountEmail ?? "—"}</code>
                </div>
                <div className="text-slate-700">
                  Folder ID: <code className="text-[10px]">{data.folderId}</code>
                </div>
                {data.listError && (
                  <div className="mt-1 text-rose-700">⚠ {data.listError}</div>
                )}
              </>
            ) : (
              <div className="text-amber-900">
                Sin configurar. Pega abajo el JSON del service account y la URL de la carpeta de Drive.
              </div>
            )}
          </div>
        )}

        {/* Pasos para obtener el service account */}
        <details className="rounded-lg border bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
            📖 Cómo crear el Service Account en Google Cloud (1ª vez)
          </summary>
          <ol className="px-3 py-3 text-[11px] text-slate-700 space-y-1 list-decimal list-inside border-t bg-white">
            <li>Entra a <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noreferrer" className="text-brand-600 underline">Google Cloud Console → IAM → Service Accounts</a></li>
            <li>Crea proyecto si no tienes (ej. "agencia-hub-backups")</li>
            <li>Habilita la <strong>Google Drive API</strong> en APIs & Services</li>
            <li><strong>Create Service Account</strong> → ponle nombre y crea</li>
            <li>En el SA recién creado → <strong>Keys</strong> → <strong>Add key → Create new key → JSON</strong> → descarga el .json</li>
            <li>Copia el campo <code className="text-[10px]">client_email</code> del JSON (algo como <code className="text-[10px]">xxx@proyecto.iam.gserviceaccount.com</code>)</li>
            <li>Ve a la carpeta de Drive donde quieres los backups → <strong>Compartir</strong> → pega ese email → permiso <strong>Editor</strong></li>
            <li>Vuelve aquí y pega el JSON completo abajo + la URL de la carpeta</li>
          </ol>
        </details>

        {/* Form */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Service Account JSON</label>
          <textarea
            value={saJson}
            onChange={(e) => setSaJson(e.target.value)}
            rows={4}
            placeholder={data?.configured ? '•••• (ya guardado; pega uno nuevo para reemplazar)' : '{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----...","client_email":"..."}'}
            className="w-full px-3 py-2 rounded-lg border bg-white text-xs font-mono"
          />
          <p className="mt-1 text-[10px] text-slate-500">Se guarda cifrado con AES-256-GCM.</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Carpeta de Drive (URL o ID)</label>
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/1B5BGHe..."
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono"
          />
          <p className="mt-1 text-[10px] text-slate-500">
            Extraemos el ID automáticamente si pegas la URL completa.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={save}
            disabled={saving || (!saJson && !folder)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar configuración"}
          </button>
          {data?.configured && (
            <>
              <button
                onClick={() => act("test")}
                disabled={busy !== null}
                className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm disabled:opacity-50"
              >
                {busy === "test" ? "Probando…" : "🔌 Test conexión"}
              </button>
              <button
                onClick={() => act("backup_now")}
                disabled={busy !== null}
                className="px-3 py-2 rounded-lg border bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700 text-sm disabled:opacity-50"
              >
                {busy === "backup_now" ? "Subiendo…" : "▶️ Backup manual ahora"}
              </button>
              <button
                onClick={() => act("cleanup")}
                disabled={busy !== null}
                className="px-3 py-2 rounded-lg border bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-700 text-sm disabled:opacity-50"
              >
                {busy === "cleanup" ? "Limpiando…" : "🧹 Limpiar huérfanos"}
              </button>
            </>
          )}
        </div>

        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        {error && <p className="text-xs text-rose-600">{error}</p>}

        {/* Lista de archivos actuales */}
        {data?.configured && Array.isArray(data.files) && (
          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Archivos actuales en la carpeta ({data.files.length})
            </div>
            {data.files.length === 0 ? (
              <p className="text-xs text-slate-500">Aún no hay backups. Pulsa "Backup manual ahora" para crear el primero.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {data.files.map((f: any) => (
                  <li key={f.id} className="flex items-center justify-between rounded border bg-slate-50/50 px-2 py-1.5">
                    <span className="font-mono">{f.name}</span>
                    <span className="text-[10px] text-slate-500">
                      {f.size ? (Number(f.size) / 1024).toFixed(1) + " KB" : "—"}
                      {f.modifiedTime && " · " + new Date(f.modifiedTime).toLocaleString("es-ES")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
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

      <WordPressCredsBlock />
      <ShareWithClaudeBlock />


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

/**
 * Form para configurar las credenciales del WordPress origen
 * (URL + usuario + Application Password) que usa /admin/wp-import.
 *
 * Se cifran en BD. Aparecen luego en el bloque de credenciales y en el
 * volcado del enlace mágico.
 */
function WordPressCredsBlock() {
  const [data, setData] = useState<{ url: string | null; user: string | null; hasPassword: boolean } | null>(null);
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/wordpress-credentials")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setData(d);
          setUrl(d.url ?? "");
          setUser(d.user ?? "");
        }
      });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    const body: any = { url: url || null, user: user || null };
    if (appPassword) body.appPassword = appPassword;
    const r = await fetch("/api/v1/admin/wordpress-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setAppPassword("");
    setSavedAt(new Date());
    // Recargar estado
    const fresh = await fetch("/api/v1/admin/wordpress-credentials").then((r) => r.json());
    setData(fresh);
  }

  async function clearPassword() {
    if (!confirm("¿Borrar la Application Password guardada?")) return;
    await fetch("/api/v1/admin/wordpress-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appPassword: null })
    });
    setAppPassword("");
    const fresh = await fetch("/api/v1/admin/wordpress-credentials").then((r) => r.json());
    setData(fresh);
  }

  return (
    <div className="px-5 py-4 bg-blue-50/40 border-b">
      <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-1.5 mb-1">
        📰 WordPress origen (para /admin/wp-import)
      </h3>
      <p className="text-xs text-slate-600 mb-3">
        URL + usuario + Application Password del WordPress de donde se importan los plugins NV.
        La password se cifra con AES-256-GCM antes de guardarse.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hub.negociovivo.com"
          className="px-3 py-2 rounded-lg border bg-white text-sm font-mono"
        />
        <input
          type="text"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="info@negociovivo.com"
          className="px-3 py-2 rounded-lg border bg-white text-sm font-mono"
        />
        <div className="flex gap-1">
          <input
            type="password"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder={data?.hasPassword ? "•••• (guardada; deja vacío para no cambiar)" : "GuNf BcaV jup8 h70H I42b l5kI"}
            className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm font-mono"
          />
          {data?.hasPassword && (
            <button
              type="button"
              onClick={clearPassword}
              className="px-2 py-1.5 rounded-md border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 text-xs"
              title="Borrar password guardada"
            >
              Borrar
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar
        </button>
        {savedAt && <span className="text-[11px] text-emerald-700">✓ Guardado a las {savedAt.toLocaleTimeString("es-ES")}</span>}
        {error && <span className="text-[11px] text-rose-600">{error}</span>}
        {data?.hasPassword && !savedAt && (
          <span className="text-[11px] text-slate-500">App Password guardada · {data.url ?? "—"}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Botón "Generar enlace para Claude": crea un grant temporal de un solo
 * uso que, al pegarlo en el chat, permite leer TODAS las credenciales
 * de una vez sin tener que copiar cada una.
 */
function ShareWithClaudeBlock() {
  const [grant, setGrant] = useState<{ token: string; expiresAt: string; path: string; id: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  useEffect(() => {
    if (!grant) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.floor((new Date(grant.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [grant]);

  async function generate() {
    setGenerating(true);
    setError(null);
    const r = await fetch("/api/v1/admin/credentials/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMinutes: 60 })
    });
    setGenerating(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    const data = await r.json();
    const url = `${window.location.origin}${data.path}`;
    setGrant({ token: data.token, expiresAt: data.expiresAt, path: data.path, id: data.id });
    // Copiar automáticamente
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  }

  async function revoke() {
    if (!grant) return;
    if (!confirm("¿Revocar este enlace? Dejará de funcionar inmediatamente.")) return;
    await fetch(`/api/v1/admin/credentials/grant/${grant.id}`, { method: "DELETE" });
    setGrant(null);
  }

  const url = grant ? `${typeof window !== "undefined" ? window.location.origin : ""}${grant.path}` : "";
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="px-5 py-4 bg-violet-50/40 border-b">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h3 className="text-sm font-semibold text-violet-900 flex items-center gap-1.5">
            🪄 Compartir credenciales con Claude (un solo uso)
          </h3>
          <p className="text-xs text-slate-600 mt-1">
            Genera un enlace temporal (1h) que descifra y devuelve TODAS las credenciales en una sola llamada.
            Se copia al portapapeles automáticamente. Pégalo en la conversación con Claude y se accederá una vez.
            Tras el primer uso, deja de funcionar.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : "🪄"}
          Generar enlace
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

      {grant && (
        <div className="mt-3 rounded-lg border border-violet-200 bg-white p-3 space-y-2">
          {copied && (
            <div className="text-xs text-emerald-700 font-medium">
              ✓ Enlace copiado al portapapeles. Pégalo en la conversación con Claude.
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
              className="flex-1 px-2 py-1.5 rounded border bg-slate-50 text-xs font-mono break-all focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded border bg-white hover:bg-slate-50 text-xs"
            >
              <CopyIcon className="h-3.5 w-3.5" />
              Copiar
            </button>
            <button
              type="button"
              onClick={revoke}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 text-xs"
            >
              Revocar
            </button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>
              Caduca en <strong className="text-violet-700">{mm}:{ss}</strong> · de un solo uso
            </span>
            <span className="text-[10px]">ID #{grant.id.slice(0, 8)}</span>
          </div>
        </div>
      )}
    </div>
  );
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
