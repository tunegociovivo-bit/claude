"use client";

/**
 * Cazador de Subvenciones: actualiza el catálogo de convocatorias abiertas
 * (BDNS) y cruza objetivos con las que les encajan (IA). El objetivo PRINCIPAL
 * es la propia agencia (Negocio Vivo): subvenciones + licitaciones públicas.
 */
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, RefreshCw, Landmark, Search, ExternalLink, Target } from "lucide-react";

// Objetivo "agencia" (Negocio Vivo): id centinela compartido con el backend.
const AGENCY_ID = "__agency__";
const AGENCY_LABEL = "Negocio Vivo (agencia)";

type Convo = { id: string; titulo: string; organo: string | null; regiones: string | null; importeTotal: number | null; fechaFin: string | null; urlBases: string | null; fuente?: string };
type Match = Convo & { fitScore: number; motivo: string; requisitos: string; estado?: string | null; taskId?: string | null; taskProjectId?: string | null };
type Status = { abiertas: number; total: number; ultimaActualizacion: string | null; convocatorias: Convo[]; clients: { id: string; name: string }[]; webhookUrl?: string; oportWebhookUrl?: string; whatsappTo?: string; whatsappSession?: string; agencyProfile?: string; digestEnabled?: boolean; sources?: { source: string; count: number }[]; sourceCoverage?: { source: string; label: string; count: number; connected: boolean; detail?: string }[]; health?: { lastRunAt?: string; lastIngestAt?: string; lastMatchAt?: string; lastNotificationAt?: string; lastError?: string | null; ingested?: number; matches?: number; notifications?: number; trigger?: string; cron?: { status: "ok" | "stale" | "never"; lastRunAt: string | null; runs: number; minutesSince: number | null } } };

const ESTADOS = [
  { v: "", t: "— Estado —" },
  { v: "interesa", t: "Interesa" },
  { v: "en_proceso", t: "En proceso" },
  { v: "presentada", t: "Presentada" },
  { v: "descartada", t: "Descartada" }
];
function diasRestantes(s: string | null): number | null {
  if (!s) return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000);
}

const eur = (n: number | null) => (n ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n) : "—");
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-ES") : "Sin plazo fijo");

export default function SubvencionesAdmin() {
  const [s, setS] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [clientId, setClientId] = useState("");
  const [matching, setMatching] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [webhook, setWebhook] = useState("");
  const [oportWebhook, setOportWebhook] = useState("");
  const [waTo, setWaTo] = useState("");
  const [waSession, setWaSession] = useState("");
  const [savingHook, setSavingHook] = useState(false);
  const [scanRows, setScanRows] = useState<{ clientId: string; clientName: string; count: number; topTitulo: string | null; topScore: number | null; topFechaFin: string | null }[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [borrador, setBorrador] = useState<{ titulo: string; text: string } | null>(null);
  const [borradorLoading, setBorradorLoading] = useState<string | null>(null);
  const [agencyProfile, setAgencyProfile] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [channelTesting, setChannelTesting] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [createdTasks, setCreatedTasks] = useState<Record<string, { id: string; projectId: string; existing?: boolean }>>({});
  const [digestEnabled, setDigestEnabled] = useState(true);

  // Nombre legible del objetivo cuyos resultados se muestran ahora.
  const targetName = clientId === AGENCY_ID ? AGENCY_LABEL : (s?.clients.find((c) => c.id === clientId)?.name ?? "");

  async function scanAll() {
    setScanning(true);
    setScanRows(null);
    try {
      const r = await fetch("/api/v1/admin/subvenciones/match-all?limit=40");
      const j = await r.json().catch(() => ({}));
      if (r.ok) setScanRows(j.rows ?? []);
    } finally {
      setScanning(false);
    }
  }
  async function verBorrador(convocatoriaId: string, titulo: string) {
    if (!clientId) return;
    setBorradorLoading(convocatoriaId);
    try {
      const r = await fetch("/api/v1/admin/subvenciones/borrador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, convocatoriaId })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setBorrador({ titulo, text: j.borrador ?? "" });
      else setMsg(`❌ ${j?.error?.message ?? "No se pudo generar el borrador"}`);
    } finally {
      setBorradorLoading(null);
    }
  }

  async function saveWebhook() {
    setSavingHook(true);
    try {
      await fetch("/api/v1/admin/subvenciones", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webhookUrl: webhook, oportWebhookUrl: oportWebhook, whatsappTo: waTo, whatsappSession: waSession, digestEnabled }) });
    } finally {
      setSavingHook(false);
    }
  }
  async function testChannel(channel: "closing_webhook" | "opportunity_webhook" | "whatsapp") {
    setChannelTesting(channel); setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/subvenciones/test-channel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel }) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? "✅ Mensaje de prueba enviado correctamente." : `❌ ${j?.error?.message ?? "No se pudo probar el canal"}`);
    } finally { setChannelTesting(null); }
  }
  async function opportunityAction(action: "feedback" | "create_task", convocatoriaId: string, verdict?: "interesa" | "no_encaja") {
    setActionLoading(`${action}:${convocatoriaId}`); setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/subvenciones/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, clientId, convocatoriaId, verdict }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        if (action === "create_task" && j.task?.id) {
          setCreatedTasks((current) => ({ ...current, [convocatoriaId]: j.task }));
          setMsg(j.task.existing ? "ℹ️ El expediente ya existía; puedes abrirlo desde el resultado." : "✅ Expediente autónomo creado con proyecto, fases y dossier inicial.");
        } else setMsg("✅ Preferencia guardada; se utilizará para afinar próximos resultados.");
      }
      else setMsg(`❌ ${j?.error?.message ?? "No se pudo completar la acción"}`);
    } finally { setActionLoading(null); }
  }
  async function setEstado(convocatoriaId: string, estado: string) {
    if (!clientId) return;
    setMatches((ms) => ms?.map((m) => (m.id === convocatoriaId ? { ...m, estado: estado || null } : m)) ?? ms);
    if (!estado) return;
    await fetch("/api/v1/admin/subvenciones/estado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, convocatoriaId, estado })
    }).catch(() => {});
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/subvenciones");
      if (r.ok) { const d = await r.json(); setS(d); setWebhook(d.webhookUrl ?? ""); setOportWebhook(d.oportWebhookUrl ?? ""); setWaTo(d.whatsappTo ?? ""); setWaSession(d.whatsappSession ?? ""); setAgencyProfile(d.agencyProfile ?? ""); setDigestEnabled(d.digestEnabled !== false); }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function ingest() {
    setIngesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/subvenciones/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`❌ ${j?.error?.message ?? "Error"}`);
      else if (j.skipped) setMsg(`⏳ ${j.message}`);
      else setMsg(`✅ ${j.upserted} de BDNS${j.curadas ? ` + ${j.curadas} curadas` : ""}${j.placsp?.upserted ? ` + ${j.placsp.upserted} licitaciones PLACSP` : ""}${j.euFunding?.upserted ? ` + ${j.euFunding.upserted} fondos europeos` : ""}${typeof j.fueraDeFoco === "number" ? ` · ${j.fueraDeFoco} descartadas por foco regional` : ""}. Diagnóstico completado sin enviar avisos.`);
      await load();
    } finally {
      setIngesting(false);
    }
  }

  async function buscar(force = false, idOverride?: string) {
    const target = idOverride ?? clientId;
    if (!target) return;
    if (idOverride && idOverride !== clientId) setClientId(idOverride);
    setMatching(true);
    setMatches(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/admin/subvenciones/match?clientId=${encodeURIComponent(target)}${force ? "&refresh=1" : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`❌ ${j?.error?.message ?? "Error"}`);
      else {
        const nextMatches: Match[] = j.matches ?? [];
        setMatches(nextMatches);
        setCreatedTasks(Object.fromEntries(nextMatches.filter((m) => m.taskId && m.taskProjectId).map((m) => [m.id, { id: m.taskId!, projectId: m.taskProjectId!, existing: true }])));
      }
    } finally {
      setMatching(false);
    }
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await fetch("/api/v1/admin/subvenciones", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencyProfile }) });
      setShowProfile(false);
      // Si ya había resultados de la agencia, refréscalos con el nuevo perfil.
      if (clientId === AGENCY_ID) void buscar(true, AGENCY_ID);
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Cazador de Subvenciones IA"
        description="Subvenciones y licitaciones públicas para Negocio Vivo (tu agencia) y, además, para tus clientes: qué encaja, por qué y qué hace falta."
        actions={
          <button onClick={ingest} disabled={ingesting} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm px-3 py-2">
            {ingesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualizar convocatorias
          </button>
        }
      />

      {loading ? (
        <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !s ? (
        <p className="text-sm text-rose-600">No se pudo cargar.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="Convocatorias abiertas" value={s.abiertas} icon={<Landmark className="h-4 w-4" />} />
            <Stat label="En catálogo" value={s.total} />
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Última actualización</div>
              <div className="mt-1 text-sm font-semibold text-slate-800">{s.ultimaActualizacion ? new Date(s.ultimaActualizacion).toLocaleString("es-ES") : "Nunca — pulsa Actualizar"}</div>
            </div>
          </div>

          <div className={`mt-4 rounded-xl border p-4 ${s.health?.cron?.status === "ok" && !s.health?.lastError ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/60"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Salud de la automatización</h2>
              <span className={`text-xs font-bold rounded-full px-2 py-1 ${s.health?.cron?.status === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{s.health?.cron?.status === "ok" ? "Operativa" : s.health?.cron?.status === "stale" ? "Ejecución retrasada" : "Sin ejecución registrada"}</span>
            </div>
            <div className="mt-2 grid sm:grid-cols-4 gap-2 text-xs text-slate-600">
              <div><strong>Última ejecución</strong><br />{s.health?.lastRunAt ? new Date(s.health.lastRunAt).toLocaleString("es-ES") : "Nunca"}</div>
              <div><strong>Último análisis</strong><br />{s.health?.lastMatchAt ? new Date(s.health.lastMatchAt).toLocaleString("es-ES") : "Nunca"}</div>
              <div><strong>Coincidencias</strong><br />{s.health?.matches ?? "—"}</div>
              <div><strong>Avisos enviados</strong><br />{s.health?.notifications ?? "—"}</div>
            </div>
            {s.health?.lastError && <p className="mt-2 text-xs text-rose-700"><strong>Último error:</strong> {s.health.lastError}</p>}
          </div>

          {/* OBJETIVO PRINCIPAL: la propia agencia (Negocio Vivo) */}
          <div className="mt-6 rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-indigo-900 flex items-center gap-1.5"><Target className="h-4 w-4" /> Mi agencia · Negocio Vivo</h2>
                <p className="text-[12px] text-indigo-700/80 mt-0.5">Subvenciones <strong>y licitaciones públicas</strong> para tu agencia de marketing (objetivo principal).</p>
              </div>
              <button onClick={() => buscar(false, AGENCY_ID)} disabled={matching} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm px-4 py-2">
                {matching && clientId === AGENCY_ID ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar para mi agencia
              </button>
            </div>
            <button onClick={() => setShowProfile((v) => !v)} className="mt-2 text-[11px] text-indigo-600 hover:underline">
              {showProfile ? "▾ Ocultar perfil de la agencia" : "▸ Editar perfil de la agencia (lo usa la IA para afinar el encaje)"}
            </button>
            {showProfile && (
              <div className="mt-2">
                <textarea value={agencyProfile} onChange={(e) => setAgencyProfile(e.target.value)} rows={9} className="w-full px-3 py-2 rounded-lg border bg-white text-[13px] font-mono leading-snug" placeholder="Describe Negocio Vivo: sector, servicios, ubicación, tipo (empresa/CIF), e intereses en subvenciones y licitaciones…" />
                <div className="mt-1.5 flex items-center gap-2">
                  <button onClick={saveProfile} disabled={savingProfile} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs px-3 py-1.5">{savingProfile ? "Guardando…" : "Guardar perfil"}</button>
                  <span className="text-[11px] text-slate-400">Si lo dejas vacío, se usa el perfil por defecto de Negocio Vivo.</span>
                </div>
              </div>
            )}
          </div>

          {/* Cruce por cliente (secundario) */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800 mb-2">…y también para un cliente</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select value={clientId === AGENCY_ID ? "" : clientId} onChange={(e) => setClientId(e.target.value)} className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border bg-white text-sm">
                <option value="">— Elige un cliente —</option>
                {s.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={() => buscar(false)} disabled={!clientId || clientId === AGENCY_ID || matching} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2">
                {matching && clientId !== AGENCY_ID ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar subvenciones
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">El resultado se cachea 12 h para no repetir el análisis IA.</p>
          </div>

          {/* Resultados (agencia o cliente) */}
          {(matches || msg) && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-800">Resultados{targetName ? <> · <span className={clientId === AGENCY_ID ? "text-indigo-700" : "text-emerald-700"}>{targetName}</span></> : null}</h2>
                {matches && !matching && clientId && <button onClick={() => buscar(true, clientId)} className="text-[11px] text-brand-600 hover:underline">↻ volver a analizar</button>}
              </div>
              {msg && <p className="mt-2 text-sm text-slate-700">{msg}</p>}
              {matches && (
                matches.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No se encontraron convocatorias que encajen claramente. Prueba a actualizar el catálogo{clientId === AGENCY_ID ? " o ajusta el perfil de la agencia" : " o revisa el sector/ubicación del cliente"}.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {matches.map((m) => (
                      <li key={m.id} className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{m.titulo}</p>
                            <p className="text-xs text-slate-500">{m.organo || "—"} · {eur(m.importeTotal)} · cierra {fecha(m.fechaFin)}</p>
                          </div>
                          <span className="shrink-0 text-xs font-black text-emerald-700 bg-white border border-emerald-200 rounded-full px-2 py-0.5">{m.fitScore}</span>
                        </div>
                        <p className="mt-1.5 text-sm text-slate-700"><strong>Encaja porque:</strong> {m.motivo}</p>
                        <p className="text-sm text-slate-600"><strong>Necesita:</strong> {m.requisitos}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {(() => { const d = diasRestantes(m.fechaFin); return d != null ? <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${d <= 7 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>⏰ cierra en {d} día{d === 1 ? "" : "s"}</span> : null; })()}
                          <select value={m.estado ?? ""} onChange={(e) => setEstado(m.id, e.target.value)} className="text-xs border rounded px-1.5 py-1 bg-white">
                            {ESTADOS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                          </select>
                          {m.urlBases && <a href={m.urlBases} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><ExternalLink className="h-3 w-3" /> Bases / sede</a>}
                          <button onClick={() => verBorrador(m.id, m.titulo)} disabled={borradorLoading === m.id} className="inline-flex items-center gap-1 text-xs rounded border border-brand-300 bg-brand-50 text-brand-700 px-2 py-0.5 hover:bg-brand-100 disabled:opacity-50">
                            {borradorLoading === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "📝"} Borrador IA
                          </button>
                          <button onClick={() => opportunityAction("feedback", m.id, "interesa")} disabled={!!actionLoading} className="text-xs rounded border border-emerald-300 bg-white text-emerald-700 px-2 py-0.5">👍 Encaja</button>
                          <button onClick={() => opportunityAction("feedback", m.id, "no_encaja")} disabled={!!actionLoading} className="text-xs rounded border border-slate-300 bg-white text-slate-600 px-2 py-0.5">👎 No encaja</button>
                          {createdTasks[m.id] ? (
                            <a href={`/tareas?project=${createdTasks[m.id].projectId}&task=${createdTasks[m.id].id}`} className="text-xs rounded bg-emerald-600 text-white px-2 py-1">✓ Expediente creado · Abrir</a>
                          ) : (
                            <button onClick={() => opportunityAction("create_task", m.id)} disabled={!!actionLoading} className="text-xs rounded bg-indigo-600 text-white px-2 py-1 disabled:opacity-50">Crear proyecto de solicitud</button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          )}

          {/* Avisos (Make) */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Avisos de cierre de plazo</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 mb-2">Cada noche se avisa de las convocatorias marcadas como <strong>Interesa/En proceso</strong> (de la agencia o de clientes) que cierran en ≤7 días, enviando un webhook a Make (email/WhatsApp).</p>
              <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hook.eu1.make.com/… (aviso de cierre)" className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
              <button onClick={() => testChannel("closing_webhook")} disabled={channelTesting !== null || !webhook} className="mt-1 text-xs text-brand-600 hover:underline disabled:opacity-40">Probar webhook de cierre</button>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-indigo-900 flex items-center gap-1.5"><Target className="h-4 w-4" /> Aviso de oportunidad TOP (agencia)</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 mb-2">Cada noche, la IA cruza el catálogo con el perfil de <strong>Negocio Vivo</strong> y avisa por este webhook de las <strong>subvenciones/licitaciones nuevas con encaje ≥78</strong> (sin repetir).</p>
              <input value={oportWebhook} onChange={(e) => setOportWebhook(e.target.value)} placeholder="https://hook.eu1.make.com/… (oportunidad TOP)" className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
              <button onClick={() => testChannel("opportunity_webhook")} disabled={channelTesting !== null || !oportWebhook} className="mt-1 text-xs text-brand-600 hover:underline disabled:opacity-40">Probar webhook de oportunidades</button>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">📲 WhatsApp por WAHA (además del email)</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 mb-2">Los dos avisos de arriba te llegarán <strong>también por WhatsApp</strong> usando WAHA (tu plan Plus). Pon tu <strong>número de destino</strong> y, opcionalmente, desde qué <strong>sesión</strong> enviarlo (p. ej. <strong>Sonia</strong>). Si dejas la sesión vacía, usa el teléfono principal. Vacío el número = solo email.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input value={waTo} onChange={(e) => setWaTo(e.target.value)} placeholder="Nº destino, ej. 34680167881" className="flex-1 min-w-[180px] px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
                <input value={waSession} onChange={(e) => setWaSession(e.target.value)} placeholder="Sesión (ej. sonia) — opcional" className="flex-1 min-w-[180px] px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
              </div>
              <button onClick={() => testChannel("whatsapp")} disabled={channelTesting !== null || !waTo} className="mt-1 text-xs text-emerald-700 hover:underline disabled:opacity-40">Probar WhatsApp</button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={digestEnabled} onChange={(e) => setDigestEnabled(e.target.checked)} /> Enviar resumen diario con las 5 mejores oportunidades y cierres próximos</label>
            <button onClick={saveWebhook} disabled={savingHook} className="rounded-lg border bg-white hover:bg-slate-50 text-sm px-3 py-2 disabled:opacity-50">{savingHook ? "Guardando…" : "Guardar webhooks"}</button>
          </div>

          {/* Escaneo masivo de clientes */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Oportunidades por cliente</h2>
              <button onClick={scanAll} disabled={scanning} className="inline-flex items-center gap-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm px-3 py-1.5 disabled:opacity-50">
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Escanear todos los clientes
              </button>
            </div>
            {scanRows && (
              scanRows.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Sin clientes activos.</p>
              ) : (
                <div className="mt-3 space-y-1">
                  {scanRows.map((r) => (
                    <button key={r.clientId} onClick={() => { setClientId(r.clientId); setTimeout(() => buscar(false), 0); }} className="w-full flex items-center justify-between gap-2 rounded-lg border bg-white hover:bg-emerald-50 px-3 py-2 text-left">
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-slate-800">{r.clientName}</span>
                        {r.topTitulo && <span className="block text-[11px] text-slate-500 truncate">Mejor: {r.topTitulo}</span>}
                      </span>
                      <span className="shrink-0 text-xs">
                        {r.count > 0 ? <span className="font-bold text-emerald-700">{r.count} oportunidad{r.count === 1 ? "" : "es"}</span> : <span className="text-slate-400">—</span>}
                        {r.topScore != null && <span className="ml-2 text-slate-400">({r.topScore})</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          {/* Catálogo */}
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Convocatorias abiertas ({s.convocatorias.length})</h2>
            <p className="text-[11px] text-slate-400 mb-2">Fuentes: <strong>BDNS</strong> (incluye convocatorias publicadas en BOJA) · <strong>PLACSP oficial</strong> (licitaciones de marketing y servicios digitales) · <strong>curadas</strong> · fuentes autorizadas vía Make.</p>
            {s.sources && <div className="mb-3 flex flex-wrap gap-1.5">{s.sources.map((x) => <span key={x.source} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{x.source}: {x.count}</span>)}</div>}
            {s.sourceCoverage && <div className="mb-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{s.sourceCoverage.map((x) => <div key={x.source} className={`rounded-lg border px-3 py-2 text-xs ${x.connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><strong>{x.connected ? "✓" : "!"} {x.label}</strong><span className="block mt-0.5">{x.connected ? `${x.count} registros` : (x.detail ?? "Pendiente de conectar mediante el endpoint externo")}</span>{x.connected && x.detail && <span className="block mt-0.5 opacity-80">{x.detail}</span>}</div>)}</div>}
            {s.convocatorias.length === 0 ? (
              <p className="text-sm text-slate-500">Catálogo vacío. Pulsa <strong>Actualizar convocatorias</strong> para traerlas de la BDNS.</p>
            ) : (
              <div className="space-y-1.5">
                {s.convocatorias.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-slate-800 truncate">
                        {c.fuente && c.fuente !== "bdns" && <span className="mr-1.5 text-[9px] font-bold uppercase rounded px-1 py-0.5 bg-indigo-100 text-indigo-700">{c.fuente}</span>}
                        {c.titulo}
                      </p>
                      <p className="text-[11px] text-slate-400">{c.organo || "—"} · {c.regiones || "ámbito no indicado"} · {eur(c.importeTotal)}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500">cierra {fecha(c.fechaFin)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {borrador && (
        <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={() => setBorrador(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 p-4 border-b">
              <h3 className="font-bold text-slate-900 text-sm">📝 Borrador de solicitud — {borrador.titulo}</h3>
              <button onClick={() => setBorrador(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <textarea readOnly value={borrador.text} className="flex-1 overflow-auto m-4 p-3 rounded-lg border bg-slate-50 text-sm font-mono leading-relaxed" rows={18} />
            <div className="flex justify-end gap-2 p-4 pt-0">
              <button onClick={() => { void navigator.clipboard?.writeText(borrador.text); }} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-2">Copiar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">{icon}{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
    </div>
  );
}
