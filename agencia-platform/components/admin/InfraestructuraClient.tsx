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
  ShieldCheck,
  RefreshCw
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

type CronHealth = {
  name: string;
  label: string;
  status: "ok" | "stale" | "never";
  lastRunAt: string | null;
  minutesSince: number | null;
  maxStaleMin: number;
};

type WhatsappHealth = { name: string; label: string | null; status: string };

type ProxyHealth = { key: string; ok: boolean; exitIp: string | null; error: string | null; checkedAt: string | null };
type SendQueue = { queued: number; sentToday: number; failedToday: number; blockedLink: number };
type LoggedError = { at: string; where: string; message: string; workspaceId?: string | null };

type Data = {
  platforms: Platform[];
  crons?: CronHealth[];
  whatsapp?: WhatsappHealth[];
  proxies?: ProxyHealth[];
  sendQueue?: SendQueue;
  recentErrors?: LoggedError[];
  codeBackup: { provider: string; repo: string; url: string; note: string };
  dbBackup: { lastAt: string | null; sizeBytes: number | null; manageUrl: string };
};

function fmtAgo(min: number | null): string {
  if (min == null) return "nunca";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `hace ${h}h ${m}min` : `hace ${h}h`;
}

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

      <CredentialsHealthPanel />

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

          {/* Estado del sistema: crons + WhatsApp */}
          {data.crons && data.crons.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50 flex items-center justify-between">
                <h2 className="font-semibold text-sm text-slate-800">Estado de los crons</h2>
                {(() => {
                  const bad = data.crons.filter((c) => c.status !== "ok").length;
                  return bad > 0 ? (
                    <span className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-0.5">
                      {bad} con problemas
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                      Todo al día
                    </span>
                  );
                })()}
              </div>
              <ul className="divide-y">
                {data.crons
                  .slice()
                  .sort((a, b) => (a.status === "ok" ? 1 : 0) - (b.status === "ok" ? 1 : 0))
                  .map((c) => {
                    const color =
                      c.status === "ok" ? "bg-emerald-500" : c.status === "stale" ? "bg-rose-500" : "bg-slate-400";
                    return (
                      <li key={c.name} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                        <span className={`h-2.5 w-2.5 rounded-full ${color} shrink-0`} />
                        <span className="flex-1 text-slate-800">{c.label}</span>
                        <span
                          className={`text-xs ${c.status === "ok" ? "text-slate-500" : "text-rose-600 font-medium"}`}
                        >
                          {c.status === "never" ? "nunca se ha ejecutado" : `última: ${fmtAgo(c.minutesSince)}`}
                        </span>
                      </li>
                    );
                  })}
              </ul>
              <p className="px-5 py-2 text-[11px] text-slate-500 border-t bg-slate-50/50">
                El vigilante avisa por email (OPS_ALERT_EMAIL) si un cron se queda mudo más de lo previsto.
              </p>
            </div>
          )}

          {data.whatsapp && data.whatsapp.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50">
                <h2 className="font-semibold text-sm text-slate-800">Números de WhatsApp (NV Leads)</h2>
              </div>
              <ul className="divide-y">
                {data.whatsapp.map((w) => {
                  const color =
                    w.status === "healthy"
                      ? "bg-emerald-500"
                      : w.status === "degraded"
                        ? "bg-amber-500"
                        : "bg-rose-500";
                  const label =
                    w.status === "healthy" ? "sano" : w.status === "degraded" ? "degradado" : "en cuarentena";
                  return (
                    <li key={w.name} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                      <span className={`h-2.5 w-2.5 rounded-full ${color} shrink-0`} />
                      <span className="flex-1 text-slate-800">{w.label || w.name}</span>
                      <span className="text-xs text-slate-500">{label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Cola de envío de WhatsApp (hoy) */}
          {data.sendQueue && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50">
                <h2 className="font-semibold text-sm text-slate-800">Cola de envío (hoy)</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5 text-center">
                <div>
                  <div className="text-2xl font-semibold text-slate-800">{data.sendQueue.queued}</div>
                  <div className="text-xs text-slate-500">en cola</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-emerald-600">{data.sendQueue.sentToday}</div>
                  <div className="text-xs text-slate-500">enviados hoy</div>
                </div>
                <div>
                  <div className={`text-2xl font-semibold ${data.sendQueue.failedToday > 0 ? "text-rose-600" : "text-slate-800"}`}>{data.sendQueue.failedToday}</div>
                  <div className="text-xs text-slate-500">fallidos hoy</div>
                </div>
                <div>
                  <div className={`text-2xl font-semibold ${data.sendQueue.blockedLink > 0 ? "text-amber-600" : "text-slate-800"}`}>{data.sendQueue.blockedLink}</div>
                  <div className="text-xs text-slate-500">bloq. por enlace</div>
                </div>
              </div>
            </div>
          )}

          {/* Proxies de salida */}
          {data.proxies && data.proxies.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50">
                <h2 className="font-semibold text-sm text-slate-800">Proxies (IP de salida)</h2>
              </div>
              <ul className="divide-y">
                {data.proxies.map((p) => (
                  <li key={p.key} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${p.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                    <span className="flex-1 text-slate-800 font-mono text-xs">{p.key}</span>
                    <span className="text-xs text-slate-500">
                      {p.ok ? `IP ${p.exitIp ?? "?"}` : p.error ?? "sin conexión"}
                      {p.checkedAt ? ` · ${new Date(p.checkedAt).toLocaleTimeString("es-ES")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Errores recientes */}
          {data.recentErrors && data.recentErrors.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-3 border-b bg-rose-50 flex items-center justify-between">
                <h2 className="font-semibold text-sm text-rose-900">Errores recientes ({data.recentErrors.length})</h2>
                <span className="text-[11px] text-rose-700">en memoria · se vacían al reiniciar</span>
              </div>
              <ul className="divide-y max-h-80 overflow-auto">
                {data.recentErrors.map((e, i) => (
                  <li key={i} className="px-5 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-rose-700">{e.where}</span>
                      <span className="text-slate-400">{new Date(e.at).toLocaleString("es-ES")}</span>
                    </div>
                    <div className="text-slate-600 font-mono whitespace-pre-wrap break-words line-clamp-3">{e.message}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
                    {/* fal.ai: campo inline para pegar/reemplazar la API
                        key sin tener que abrir un post del calendario.
                        Se muestra siempre (configurado o no). */}
                    {p.key === "fal" && (
                      <FalKeyInline onSaved={reload} configured={p.configured} />
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

type HealthCheck = { integration: string; ok: boolean; detail?: string | null; reason?: string };

/** Panel de salud de credenciales: valida en vivo las integraciones y avisa
 *  si un token está caducado o a punto de caducar (sobre todo el de Meta). */
function CredentialsHealthPanel() {
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [meta, setMeta] = useState<{ expiresAt: string | null; metaUserId: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/v1/admin/credentials-health");
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const d = await r.json();
      setChecks(d.checks ?? []);
      setMeta(d.meta ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  const LABELS: Record<string, string> = {
    meta_ads: "Meta Ads",
    make: "Make.com",
    holded: "Holded",
    openai: "OpenAI",
    anthropic: "Anthropic",
    elevenlabs: "ElevenLabs",
    google_calendar: "Google Calendar"
  };

  // Aviso de caducidad del token de Meta.
  let metaWarn: { tone: "ok" | "warn" | "bad"; text: string } | null = null;
  if (meta) {
    if (!meta.expiresAt) metaWarn = { tone: "ok", text: "Token de Meta sin caducidad ✓" };
    else {
      const days = Math.round((new Date(meta.expiresAt).getTime() - Date.now()) / 86_400_000);
      if (days < 0) metaWarn = { tone: "bad", text: `Token de Meta CADUCADO hace ${-days} día(s) — renuévalo` };
      else if (days <= 7) metaWarn = { tone: "warn", text: `Token de Meta caduca en ${days} día(s) — renuévalo pronto` };
      else metaWarn = { tone: "ok", text: `Token de Meta válido (caduca en ${days} días)` };
    }
  }

  return (
    <div className="rounded-xl border bg-white p-4 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-5 w-5 text-brand-600" />
        <h2 className="font-semibold text-sm">Salud de credenciales</h2>
        <button
          onClick={run}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Comprobar ahora
        </button>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        Valida en vivo los tokens de las integraciones. Sonia también lo comprueba sola al arrancar tareas que las usan.
      </p>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {!checks && !loading && !err && (
        <p className="text-xs text-slate-400">Pulsa «Comprobar ahora» para validar las credenciales.</p>
      )}
      {checks && (
        <div className="space-y-1.5">
          {metaWarn && (
            <div
              className={
                "text-xs px-2.5 py-1.5 rounded-lg border " +
                (metaWarn.tone === "bad"
                  ? "bg-rose-50 border-rose-200 text-rose-800"
                  : metaWarn.tone === "warn"
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-emerald-50 border-emerald-200 text-emerald-800")
              }
            >
              {metaWarn.text}
            </div>
          )}
          {checks.length === 0 ? (
            <p className="text-xs text-slate-400">No hay integraciones con credenciales configuradas.</p>
          ) : (
            checks.map((c) => (
              <div key={c.integration} className="flex items-center gap-2 text-sm">
                {c.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                )}
                <span className="font-medium">{LABELS[c.integration] ?? c.integration}</span>
                <span className={"text-xs " + (c.ok ? "text-slate-500" : "text-rose-600")}>
                  {c.ok ? c.detail ?? "OK" : c.reason ?? "fallo"}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FalKeyInline({ onSaved, configured }: { onSaved: () => void; configured?: boolean }) {
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

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
      setOk(true);
      setTimeout(() => setOk(false), 2500);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1.5 max-w-md">
        <input
          type="password"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={configured ? "Pega una FAL_KEY nueva para reemplazar…" : "Pega la FAL_KEY (id:secret)"}
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
      </div>
      {err && <span className="text-[11px] text-rose-600">{err}</span>}
      {ok && <span className="text-[11px] text-emerald-600">✓ Key guardada cifrada.</span>}
    </div>
  );
}
