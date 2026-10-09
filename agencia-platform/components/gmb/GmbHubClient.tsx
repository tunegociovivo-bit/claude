"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import GrowthCenter from "@/components/gmb/GrowthCenter";
import PortfolioView from "@/components/gmb/PortfolioView";
import AlertsView from "@/components/gmb/AlertsView";
import FakeReviewsView from "@/components/gmb/FakeReviewsView";
import ReviewLinkView from "@/components/gmb/ReviewLinkView";
import GbpConnectWizard from "@/components/gmb/GbpConnectWizard";
import PerformancePanel from "@/components/gmb/PerformancePanel";
import {
  Loader2,
  Plus,
  Star,
  MessageSquare,
  Sparkles,
  Send,
  X,
  MapPin,
  Settings,
  Copy,
  Check,
  Gauge,
  Users,
  Megaphone,
  Image as ImageIcon,
  HelpCircle,
  FileText,
  Trash2,
  Calendar,
  Bell,
  RefreshCw,
  TrendingUp
} from "lucide-react";

type Ficha = {
  id: string;
  name: string;
  category: string;
  tone?: string;
  accountId?: string;
  locationId?: string;
  emails?: string;
  rating: number;
  reviewCount: number;
  unreplied: number;
  status: string;
};

type Review = {
  id: string;
  reviewId: string;
  authorName: string;
  authorPhoto: string;
  rating: number;
  comment: string | null;
  reviewReply: string | null;
  reviewTime: string | null;
  updateTime?: string | null;
};

function fmtDate(d?: string | null) {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  return t.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={"h-3.5 w-3.5 " + (i <= Math.round(n) ? "text-amber-400 fill-amber-400" : "text-slate-300")}
        />
      ))}
    </span>
  );
}

export default function GmbHubClient() {
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [connectBanner, setConnectBanner] = useState<string | null>(null);
  const [view, setView] = useState<"fichas" | "portfolio" | "alertas" | "buscador" | "crecimiento" | "resenas-falsas" | "enlace-resenas">("fichas");
  useEffect(() => {
    // Enlaces profundos (p. ej. desde las alertas): /gmb-hub?view=resenas-falsas&sub=retiradas
    const v = new URLSearchParams(window.location.search).get("view");
    if (v === "resenas-falsas" || v === "enlace-resenas" || v === "alertas" || v === "portfolio" || v === "buscador" || v === "crecimiento") setView(v);
  }, []);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/gmb/clients");
    if (r.ok) {
      const d = await r.json();
      setFichas(d.clients ?? []);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  // Al volver del OAuth de Google (callback → /gmb-hub?gbp=…), retoma el asistente
  // en el paso adecuado y muestra un mensaje humano. Luego limpia la URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const gbp = new URLSearchParams(window.location.search).get("gbp");
    if (!gbp) return;
    if (gbp === "connected" || gbp === "connected_no_scope") {
      setShowConnect(true);
    } else {
      const msgs: Record<string, string> = {
        denied: "Cancelaste la autorización de Google. Puedes intentarlo de nuevo cuando quieras.",
        invalid: "El enlace de conexión no era válido. Vuelve a iniciar la conexión.",
        invalid_session: "La sesión no coincidía. Inicia la conexión otra vez desde aquí.",
        expired: "El enlace de conexión caducó. Vuelve a iniciar la conexión.",
        no_refresh: "Google no devolvió un permiso permanente. Reintenta y acepta el acceso sin conexión.",
        no_config: "La conexión con Google aún no está disponible. Avisa a un administrador.",
        failed: "No se pudo completar la conexión con Google. Inténtalo de nuevo.",
      };
      setConnectBanner(msgs[gbp] ?? null);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("gbp");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const totalUnreplied = fichas.reduce((s, f) => s + (f.unreplied ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="GMB Hub"
        description="Centro de crecimiento SEO local: presencia, citaciones NAP, rank grid, contenido, reseñas inteligentes y un piloto con AI Council. Las reseñas entran vía Make."
        actions={
          <>
            <NotificationsBell />
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white text-sm hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Importar
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white text-sm hover:bg-slate-50"
            >
              <Settings className="h-4 w-4" />
              Ajustes
            </button>
            <button
              onClick={() => setShowConnect(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-white text-brand-700 text-[10px] font-bold">G</span>
              Conectar con Google
            </button>
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white text-sm hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Nueva ficha
            </button>
          </>
        }
      />

      {connectBanner && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-600">
          <span>{connectBanner}</span>
          <button onClick={() => setConnectBanner(null)} className="text-slate-400 hover:text-slate-700 shrink-0" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <GbpConnectWizard open={showConnect} onClose={() => setShowConnect(false)} onLinked={load} />

      <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1 w-fit">
        {([
          ["fichas", "Fichas"],
          ["portfolio", "Portfolio"],
          ["alertas", "Alertas"],
          ["crecimiento", "Crecimiento local"],
          ["buscador", "Buscador GMB"],
          ["resenas-falsas", "Reseñas falsas"],
          ["enlace-resenas", "Enlace de reseñas"]
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={
              "px-3 py-1.5 rounded-md text-sm font-medium " +
              (view === k ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-800")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {view === "buscador" && <BuscadorView />}

      {view === "portfolio" && <PortfolioView />}

      {view === "alertas" && <AlertsView />}

      {view === "crecimiento" && <GrowthCenter />}

      {view === "resenas-falsas" && <FakeReviewsView />}

      {view === "enlace-resenas" && <ReviewLinkView />}

      {view === "fichas" && (
      <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Kpi label="Fichas" value={fichas.length} />
        <Kpi label="Activas" value={fichas.filter((f) => f.status === "active").length} />
        <Kpi label="Reseñas" value={fichas.reduce((s, f) => s + (f.reviewCount ?? 0), 0)} />
        <Kpi label="Sin responder" value={totalUnreplied} tone={totalUnreplied > 0 ? "amber" : "default"} />
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : fichas.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center">
          <div className="text-sm text-slate-600 mb-4">
            Aún no tienes fichas. Conéctate con Google y elige tus fichas de Business Profile —
            sin introducir IDs ni claves.
          </div>
          <button
            onClick={() => setShowConnect(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-white text-brand-700 text-[10px] font-bold">G</span>
            Conectar con Google
          </button>
          <div className="text-[12px] text-slate-400 mt-3">
            ¿Prefieres crearla a mano?{" "}
            <button onClick={() => setShowNew(true)} className="text-brand-600 underline">
              Crear ficha manualmente
            </button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {fichas.map((f) => (
            <button
              key={f.id}
              onClick={() => setOpenId(f.id)}
              className="text-left bg-white rounded-xl border p-4 hover:border-brand-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{f.name}</div>
                  {f.category && <div className="text-[11px] text-slate-500">{f.category}</div>}
                </div>
                <span
                  className={
                    "text-[10px] px-2 py-0.5 rounded-full " +
                    (f.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")
                  }
                >
                  {f.status === "active" ? "Activa" : "Pausada"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <Stars n={f.rating} /> {f.rating?.toFixed(1)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" /> {f.reviewCount}
                </span>
                {f.unreplied > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                    {f.unreplied} sin responder
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      </>
      )}

      {openId && <FichaDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {showNew && (
        <NuevaFicha
          onClose={() => setShowNew(false)}
          onConnectGoogle={() => {
            setShowNew(false);
            setShowConnect(true);
          }}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
      {showSettings && <GmbSettings onClose={() => setShowSettings(false)} />}
      {showImport && (
        <ImportFichas
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function ImportFichas({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      let clients: any;
      const parsed = JSON.parse(text);
      clients = Array.isArray(parsed) ? parsed : parsed.clients;
      if (!Array.isArray(clients)) throw new Error("El JSON debe ser un array de fichas o { clients: [...] }");
      const r = await fetch("/api/v1/gmb/clients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setMsg(`Importadas: ${d.created} nuevas, ${d.updated} actualizadas.`);
      setTimeout(onDone, 900);
    } catch (e: any) {
      setMsg(e?.message ?? "JSON inválido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-semibold text-sm">Importar fichas</div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[12px] text-slate-600">
            Pega el JSON de tus fichas (export del GMB Hub de WordPress, o un array con{" "}
            <code>name, category, accountId, locationId, emails, tone, mainKeyword</code>). Se importan por nombre
            (actualiza si ya existe).
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder='[ { "name": "Clínica Aitziber", "category": "Clínica dental", "locationId": "accounts/123/locations/456" } ]'
            className="w-full px-3 py-2 rounded-lg border text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {msg && <p className="text-xs text-slate-600">{msg}</p>}
          <button
            onClick={run}
            disabled={busy || !text.trim()}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Importar
          </button>
        </div>
      </div>
    </div>
  );
}

function BuscadorView() {
  const [locations, setLocations] = useState("");
  const [keyword, setKeyword] = useState("");
  const [radiusKm, setRadiusKm] = useState(3);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [saved, setSaved] = useState<any[]>([]);
  const [savingSearch, setSavingSearch] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  async function loadSaved() {
    const r = await fetch("/api/v1/gmb/buscador/searches");
    if (r.ok) setSaved((await r.json()).searches ?? []);
  }
  useEffect(() => { loadSaved(); }, []);

  async function saveSearch() {
    const locs = locations.split("\n").map((l) => l.trim()).filter(Boolean);
    if (locs.length === 0) { setErr("Indica al menos una localización para guardar."); return; }
    const name = window.prompt("Nombre de la búsqueda:", keyword || locs[0]);
    if (!name) return;
    setSavingSearch(true);
    try {
      await fetch("/api/v1/gmb/buscador/searches", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, locations: locs.join("\n"), keyword: keyword.trim() || undefined, radiusKm })
      });
      loadSaved();
    } finally { setSavingSearch(false); }
  }

  async function runSaved(id: string) {
    setRunningId(id); setErr(null);
    try {
      const r = await fetch(`/api/v1/gmb/buscador/searches/${id}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verify: true })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      await loadSaved();
      await loadSavedResults(id);
    } catch (e: any) { setErr(e?.message ?? "Error"); } finally { setRunningId(null); }
  }

  async function loadSavedResults(id: string) {
    const r = await fetch(`/api/v1/gmb/buscador/searches/${id}/results`);
    if (r.ok) {
      const d = await r.json();
      setResults((d.results ?? []).map((x: any) => ({ ...x, isClaimable: x.checked ? x.isClaimable : undefined })));
    }
  }

  async function setSchedule(id: string, schedule: string) {
    await fetch(`/api/v1/gmb/buscador/searches/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedule })
    });
    loadSaved();
  }

  async function delSaved(id: string) {
    await fetch(`/api/v1/gmb/buscador/searches/${id}`, { method: "DELETE" });
    loadSaved();
  }

  async function run() {
    const locs = locations
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (locs.length === 0) {
      setErr("Indica al menos una localización (una por línea).");
      return;
    }
    setRunning(true);
    setErr(null);
    setResults([]);
    try {
      const r = await fetch("/api/v1/gmb/buscador/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations: locs, keyword: keyword.trim() || undefined, radiusKm })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setResults((d.results ?? []).map((x: any) => ({ ...x, isClaimable: undefined })));
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setRunning(false);
    }
  }

  async function verifyAll() {
    setVerifying(true);
    const queue = results.slice();
    const CONCURRENCY = 4;
    let idx = 0;
    async function worker() {
      while (idx < queue.length) {
        const i = idx++;
        const place = queue[i];
        try {
          const r = await fetch("/api/v1/gmb/buscador/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ placeId: place.placeId, name: place.name })
          });
          const d = await r.json();
          setResults((prev) =>
            prev.map((p) => (p.placeId === place.placeId ? { ...p, isClaimable: r.ok ? d.isClaimable : null } : p))
          );
        } catch {
          setResults((prev) => prev.map((p) => (p.placeId === place.placeId ? { ...p, isClaimable: null } : p)));
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setVerifying(false);
  }

  function exportCsv() {
    const rows = [["Nombre", "Dirección", "Rating", "Reseñas", "Reclamable", "PlaceId"]];
    for (const r of results) {
      rows.push([
        r.name ?? "",
        r.address ?? "",
        String(r.rating ?? ""),
        String(r.reviewCount ?? ""),
        r.isClaimable === true ? "SÍ" : r.isClaimable === false ? "no" : "?",
        r.placeId ?? ""
      ]);
    }
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "buscador-gmb.csv";
    a.click();
  }

  const claimable = results.filter((r) => r.isClaimable === true).length;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <p className="text-[12px] text-slate-600">
          Encuentra negocios en Google Maps por zona y detecta cuáles están <strong>sin reclamar</strong> (oportunidades
          de venta). Necesita la Maps API key, y para detectar reclamables, la key de ScraperAPI (en Ajustes).
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Localizaciones (una por línea)</label>
            <textarea
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
              rows={3}
              placeholder={"Torremolinos\nBenalmádena\nFuengirola\nMijas"}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tipo de negocio / keyword</label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Ej: clínica dental"
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Radio: {radiusKm} km</label>
              <input
                type="range"
                min={1}
                max={20}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                className="w-full accent-brand-600"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Buscar
          </button>
          {results.length > 0 && (
            <>
              <button
                onClick={verifyAll}
                disabled={verifying}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Detectar reclamables
              </button>
              <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm hover:bg-slate-50">
                Exportar CSV
              </button>
            </>
          )}
          <button
            onClick={saveSearch}
            disabled={savingSearch}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {savingSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Guardar búsqueda
          </button>
        </div>
        {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2">{err.includes("Maps") || err.includes("key") ? "Falta la Google Maps API key (Ajustes)." : err}</div>}
      </div>

      {saved.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-2 border-b text-xs font-semibold text-slate-600">Búsquedas guardadas</div>
          <div className="divide-y">
            {saved.map((s) => (
              <div key={s.id} className="px-4 py-2.5 flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {s.totalFound} fichas · <span className="text-emerald-700">{s.totalClaimable} reclamables</span>
                    {s.lastRun && ` · ${new Date(s.lastRun).toLocaleDateString("es-ES")}`}
                  </div>
                </div>
                <select
                  value={s.schedule}
                  onChange={(e) => setSchedule(s.id, e.target.value)}
                  className="px-2 py-1 rounded-lg border text-xs"
                  title="Programación"
                >
                  <option value="none">Manual</option>
                  <option value="daily">Diario</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                </select>
                <button onClick={() => loadSavedResults(s.id)} className="px-2 py-1 rounded-lg border text-xs hover:bg-slate-50">Ver</button>
                <button onClick={() => runSaved(s.id)} disabled={runningId === s.id}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-600 text-white text-xs hover:bg-brand-700 disabled:opacity-50">
                  {runningId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                  Ejecutar
                </button>
                <button onClick={() => delSaved(s.id)} className="h-7 w-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-2 border-b text-xs text-slate-500 flex items-center justify-between">
            <span>{results.length} negocios</span>
            {claimable > 0 && <span className="text-emerald-700 font-medium">{claimable} reclamables</span>}
          </div>
          <div className="divide-y max-h-[60vh] overflow-y-auto">
            {results.map((r) => (
              <div key={r.placeId} className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{r.address}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {r.rating ? `${r.rating}★ · ${r.reviewCount}` : "sin reseñas"}
                  </span>
                  {r.isClaimable === true && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Reclamable</span>
                  )}
                  {r.isClaimable === false && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Con dueño</span>
                  )}
                  {r.isClaimable === null && <span className="text-[10px] text-slate-400">?</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" | "default" }) {
  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={"text-xl font-bold " + (tone === "amber" ? "text-amber-600" : "text-slate-900")}>{value}</div>
    </div>
  );
}

function FichaDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ client: any; reviews: Review[]; averageRating: number; totalReviewCount: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [onlyUnreplied, setOnlyUnreplied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<
    "reviews" | "rendimiento" | "posts" | "fotos" | "qa" | "plantillas" | "seo" | "competitors" | "ranking" | "editar"
  >("reviews");

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/v1/gmb/clients/${id}/reviews${onlyUnreplied ? "?unreplied=1" : ""}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onlyUnreplied]);

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/reviews/sync`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setSyncMsg(d.ok ? `Sincronizado con Google: ${d.imported} reseñas nuevas, ${d.updated} actualizadas.` : `No se pudieron traer las reseñas: ${d.message ?? "error"}`);
      await load();
      onChanged();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-slate-50 rounded-2xl border w-full max-w-2xl my-8 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b bg-white rounded-t-2xl sticky top-0 z-10">
          <div className="font-semibold text-sm">{data?.client?.name ?? "Ficha"}</div>
          <div className="flex items-center gap-1">
            <a
              href={`/gmb-hub/report/${id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border bg-white text-xs hover:bg-slate-50"
              title="Informe imprimible / PDF"
            >
              <FileText className="h-3.5 w-3.5" /> Informe
            </a>
            <CreateScenarioButton id={id} />
            <SnapshotButton id={id} />
            <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex gap-1 px-4 pt-3 flex-wrap">
          {([
            ["reviews", "Reseñas", MessageSquare],
            ["rendimiento", "Rendimiento", TrendingUp],
            ["posts", "Publicaciones", Megaphone],
            ["fotos", "Fotos", ImageIcon],
            ["qa", "Q&A", HelpCircle],
            ["plantillas", "Plantillas", FileText],
            ["seo", "SEO", Gauge],
            ["competitors", "Competencia", Users],
            ["ranking", "Ranking", MapPin],
            ["editar", "Editar", Settings]
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 " +
                (tab === k ? "border-brand-500 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === "rendimiento" && <PerformancePanel id={id} />}
        {tab === "posts" && <PostsPanel id={id} />}
        {tab === "fotos" && <PhotosPanel id={id} />}
        {tab === "qa" && <QaPanel id={id} />}
        {tab === "plantillas" && <TemplatesPanel id={id} />}
        {tab === "seo" && <SeoPanel id={id} />}
        {tab === "competitors" && <CompetitorsPanel id={id} />}
        {tab === "ranking" && <RankingPanel id={id} />}
        {tab === "editar" && <EditFichaPanel id={id} onSaved={() => { load(); onChanged(); }} />}

        {tab === "reviews" && (
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setOnlyUnreplied(false)}
              className={"px-2.5 py-1 rounded-lg border " + (!onlyUnreplied ? "bg-brand-50 border-brand-300 text-brand-700" : "bg-white")}
            >
              Todas
            </button>
            <button
              onClick={() => setOnlyUnreplied(true)}
              className={"px-2.5 py-1 rounded-lg border " + (onlyUnreplied ? "bg-brand-50 border-brand-300 text-brand-700" : "bg-white")}
            >
              Sin responder
            </button>
            <button
              onClick={syncNow}
              disabled={syncing}
              className="px-2.5 py-1 rounded-lg border bg-white inline-flex items-center gap-1 disabled:opacity-50"
              title="Traer ahora las reseñas desde Google"
            >
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Sincronizar con Google
            </button>
            {data && (
              <span className="ml-auto text-slate-500 inline-flex items-center gap-1">
                <Stars n={data.averageRating} /> {data.averageRating?.toFixed(1)} · {data.totalReviewCount} reseñas
              </span>
            )}
          </div>

          {data && data.reviews.some((r) => !r.reviewReply) && (
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() =>
                  setSelected((prev) =>
                    prev.size ? new Set() : new Set(data.reviews.filter((r) => !r.reviewReply).slice(0, 25).map((r) => r.reviewId))
                  )
                }
                className="px-2.5 py-1 rounded-lg border bg-white"
              >
                {selected.size ? "Quitar selección" : "Seleccionar sin responder"}
              </button>
              <span className="text-slate-500">Marca varias reseñas para responderlas a la vez.</span>
            </div>
          )}
          {data && selected.size > 0 && (
            <BulkReplyPanel
              clientId={id}
              reviews={data.reviews.filter((r) => selected.has(r.reviewId))}
              onClear={() => setSelected(new Set())}
              onDone={() => {
                setSelected(new Set());
                load();
                onChanged();
              }}
            />
          )}
          {(syncMsg || (data as any)?.syncError) && (
            <div className="text-[12px] rounded-lg border bg-slate-50 p-2 text-slate-600">{syncMsg || `No se pudieron traer las reseñas de Google: ${(data as any).syncError}`}</div>
          )}
          {loading ? (
            <div className="text-sm text-slate-500 flex items-center gap-2 p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando reseñas…
            </div>
          ) : !data || data.reviews.length === 0 ? (
            <div className="text-sm text-slate-500 text-center p-8 bg-white rounded-xl border">
              No hay reseñas {onlyUnreplied ? "sin responder" : ""}. Pulsa «Sincronizar con Google» para traerlas; las nuevas llegan solas vía Make.
            </div>
          ) : (
            data.reviews.map((rev) => (
              <ReviewCard
                key={rev.id}
                clientId={id}
                review={rev}
                onReplied={() => { load(); onChanged(); }}
                selected={selected.has(rev.reviewId)}
                onToggle={() =>
                  setSelected((prev) => {
                    const n = new Set(prev);
                    if (n.has(rev.reviewId)) n.delete(rev.reviewId);
                    else if (n.size < 25) n.add(rev.reviewId);
                    return n;
                  })
                }
              />
            ))
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function ReviewCard({
  clientId,
  review,
  onReplied,
  selected,
  onToggle
}: {
  clientId: string;
  review: Review;
  onReplied: () => void;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const [reply, setReply] = useState(review.reviewReply ?? "");
  const [editing, setEditing] = useState(!review.reviewReply);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function suggest() {
    setSuggesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/gmb/ai-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, reviewId: review.reviewId })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setReply(d.reply ?? "");
      setEditing(true);
    } catch (e: any) {
      setMsg(e?.message ?? "Error generando respuesta");
    } finally {
      setSuggesting(false);
    }
  }

  async function publish() {
    if (!reply.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${clientId}/reviews/${encodeURIComponent(review.reviewId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setEditing(false);
      setMsg(d.sentToGoogle ? "✓ Publicada en Google" : "Guardada (configura el webhook de Make para publicar en Google)");
      onReplied();
    } catch (e: any) {
      setMsg(e?.message ?? "Error al publicar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {onToggle && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggle}
              className="h-4 w-4 shrink-0"
              aria-label="Seleccionar para responder en bloque"
            />
          )}
          <div className="font-medium text-sm truncate">{review.authorName || "Anónimo"}</div>
          {review.reviewTime && (
            <span className="text-[11px] text-slate-400 shrink-0" title={new Date(review.reviewTime).toLocaleString("es-ES")}>
              {fmtDate(review.reviewTime)}
              {review.updateTime && fmtDate(review.updateTime) !== fmtDate(review.reviewTime) ? ` · editada ${fmtDate(review.updateTime)}` : ""}
            </span>
          )}
        </div>
        <Stars n={review.rating} />
      </div>
      {review.comment && <p className="text-[13px] text-slate-700 mt-1 whitespace-pre-wrap">{review.comment}</p>}

      {review.reviewReply && !editing ? (
        <div className="mt-2 pl-3 border-l-2 border-emerald-300 bg-emerald-50/50 rounded-r p-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-0.5">Tu respuesta</div>
          <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{review.reviewReply}</p>
          <button onClick={() => setEditing(true)} className="text-[11px] text-brand-600 underline mt-1">
            Editar
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Escribe la respuesta…"
            className="w-full px-3 py-2 rounded-lg border text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={suggest}
              disabled={suggesting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Sugerir IA
            </button>
            <button
              onClick={publish}
              disabled={busy || !reply.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Publicar respuesta
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-[11px] text-slate-500 mt-1">{msg}</p>}
    </div>
  );
}

function BulkReplyPanel({
  clientId,
  reviews,
  onClear,
  onDone
}: {
  clientId: string;
  reviews: Review[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setErr(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${clientId}/reviews/ai-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewIds: reviews.map((x) => x.reviewId) })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d?.error?.message ?? "No se pudieron generar las respuestas.");
      setTexts((prev) => {
        const n = { ...prev };
        for (const x of d.drafts ?? []) if (x.reply) n[x.reviewId] = x.reply;
        return n;
      });
      setStatus((prev) => {
        const n = { ...prev };
        for (const x of d.drafts ?? []) if (x.error) n[x.reviewId] = `Error IA: ${x.error}`;
        return n;
      });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function publishAll() {
    setPublishing(true);
    setErr(null);
    let ok = 0;
    for (const rv of reviews) {
      const text = (texts[rv.reviewId] ?? "").trim();
      if (!text) continue;
      setStatus((p) => ({ ...p, [rv.reviewId]: "Publicando…" }));
      try {
        const r = await fetch(`/api/v1/gmb/clients/${clientId}/reviews/${encodeURIComponent(rv.reviewId)}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: text })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error?.message ?? "Error");
        ok++;
        setStatus((p) => ({ ...p, [rv.reviewId]: d.sentToGoogle ? "✓ Publicada en Google" : `Guardada, no publicada${d.note ? `: ${d.note}` : ""}` }));
      } catch (e: any) {
        setStatus((p) => ({ ...p, [rv.reviewId]: `Error: ${e.message}` }));
      }
    }
    setPublishing(false);
    if (ok === reviews.length) onDone();
  }

  const ready = reviews.filter((r) => (texts[r.reviewId] ?? "").trim()).length;

  return (
    <div className="bg-white rounded-xl border-2 border-brand-200 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold">Responder {reviews.length} reseña{reviews.length === 1 ? "" : "s"} a la vez</div>
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            disabled={generating || publishing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs hover:bg-slate-50 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generar respuestas con IA
          </button>
          <button
            onClick={publishAll}
            disabled={publishing || generating || ready === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Publicar {ready > 0 ? `(${ready})` : ""}
          </button>
          <button onClick={onClear} className="text-xs text-slate-500 hover:underline">Cancelar</button>
        </div>
      </div>
      {err && <div className="text-[12px] text-rose-700">{err}</div>}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {reviews.map((rv) => (
          <div key={rv.reviewId} className="border rounded-lg p-2">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="font-medium truncate">
                {rv.authorName || "Anónimo"} <span className="text-slate-400 font-normal">· {fmtDate(rv.reviewTime)}</span>
              </span>
              <Stars n={rv.rating} />
            </div>
            {rv.comment && <p className="text-[12px] text-slate-600 mt-1 line-clamp-3">{rv.comment}</p>}
            <textarea
              value={texts[rv.reviewId] ?? ""}
              onChange={(e) => setTexts((p) => ({ ...p, [rv.reviewId]: e.target.value }))}
              rows={3}
              placeholder={generating ? "Generando…" : "Pulsa «Generar respuestas con IA» o escribe la respuesta"}
              className="w-full mt-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {status[rv.reviewId] && <div className="text-[11px] text-slate-500 mt-0.5">{status[rv.reviewId]}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SeoPanel({ id }: { id: string }) {
  const [audit, setAudit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/v1/gmb/clients/${id}/seo-audit`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAudit(d?.audit ?? null))
      .finally(() => setLoading(false));
  }, [id]);
  if (loading)
    return (
      <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Analizando…
      </div>
    );
  if (!audit) return <div className="p-6 text-sm text-slate-500">No se pudo calcular la auditoría.</div>;
  const tone = audit.score >= 80 ? "text-emerald-600" : audit.score >= 50 ? "text-amber-600" : "text-rose-600";
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={"text-3xl font-bold " + tone}>{audit.score}</div>
        <div className="text-xs text-slate-500">Puntuación SEO local (0-100)</div>
      </div>
      <div className="space-y-1">
        {audit.checks.map((c: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            {c.ok ? (
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <X className="h-4 w-4 text-rose-500 shrink-0" />
            )}
            <span className={c.ok ? "text-slate-700" : "text-slate-900 font-medium"}>{c.label}</span>
          </div>
        ))}
      </div>
      {audit.recommendations?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-amber-900 mb-1">Recomendaciones</div>
          <ul className="text-[12px] text-amber-900 list-disc pl-4 space-y-0.5">
            {audit.recommendations.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RankingPanel({ id }: { id: string }) {
  const [keyword, setKeyword] = useState("");
  const [size, setSize] = useState(5);
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<any[]>([]);

  async function loadKeywords() {
    const r = await fetch(`/api/v1/gmb/clients/${id}/keywords`);
    if (r.ok) setKeywords((await r.json()).keywords ?? []);
  }
  useEffect(() => {
    loadKeywords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function scan(kw?: string) {
    const k = (kw ?? keyword).trim();
    if (!k) return;
    setRunning(true);
    setErr(null);
    setRes(null);
    try {
      // guardar keyword (no bloqueante)
      fetch(`/api/v1/gmb/clients/${id}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: k })
      }).then(loadKeywords);
      const r = await fetch(`/api/v1/gmb/clients/${id}/grid-rank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: k, size })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setRes(d);
      loadKeywords();
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setRunning(false);
    }
  }

  function cellColor(pos: number | null): string {
    if (pos === null) return "bg-slate-200 text-slate-400";
    if (pos <= 3) return "bg-emerald-500 text-white";
    if (pos <= 10) return "bg-amber-400 text-amber-950";
    return "bg-rose-400 text-white";
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Búsqueda, ej: cerrajero Torremolinos"
          className="flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="px-2 py-2 rounded-lg border text-sm">
          {[3, 5, 7].map((s) => (
            <option key={s} value={s}>
              {s}×{s}
            </option>
          ))}
        </select>
        <button
          onClick={() => scan()}
          disabled={running || !keyword.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          Escanear
        </button>
      </div>

      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((k) => (
            <button
              key={k.id}
              onClick={() => {
                setKeyword(k.keyword);
                scan(k.keyword);
              }}
              className="text-[11px] px-2 py-1 rounded-full border bg-white hover:bg-slate-50"
              title={k.avgPosition ? `Posición media: ${k.avgPosition}` : "Sin medir"}
            >
              {k.keyword}
              {k.avgPosition ? ` · #${k.avgPosition}` : ""}
            </button>
          ))}
        </div>
      )}

      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">{err.includes("Maps") || err.includes("key") ? "Falta la Google Maps API key (configúrala en Ajustes)." : err}</div>}
      {running && (
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Escaneando el mapa por zonas… (puede tardar)
        </div>
      )}

      {res && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white rounded-lg border p-2">
              <div className="text-[10px] text-slate-500">Posición media</div>
              <div className="text-sm font-semibold">{res.avgPosition || "—"}</div>
            </div>
            <div className="bg-white rounded-lg border p-2">
              <div className="text-[10px] text-slate-500">Zonas en top 3</div>
              <div className="text-sm font-semibold">{res.top3Count}/{res.cellCount}</div>
            </div>
            <div className="bg-white rounded-lg border p-2">
              <div className="text-[10px] text-slate-500">Aparece en</div>
              <div className="text-sm font-semibold">{res.foundCount}/{res.cellCount}</div>
            </div>
          </div>
          <div
            className="grid gap-1 mx-auto w-fit"
            style={{ gridTemplateColumns: `repeat(${Math.sqrt(res.cells.length)}, minmax(0, 1fr))` }}
          >
            {res.cells.map((c: any, i: number) => (
              <div
                key={i}
                className={"h-9 w-9 rounded grid place-items-center text-[11px] font-bold " + cellColor(c.position)}
                title={c.position ? `Posición ${c.position}` : "No aparece"}
              >
                {c.position ?? "–"}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-500" /> Top 3</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-400" /> 4-10</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-rose-400" /> +10</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-slate-200" /> No aparece</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CompetitorsPanel({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [kw, setKw] = useState("");
  const [scope, setScope] = useState<"ciudad" | "provincia">("ciudad");
  const [origin, setOrigin] = useState("");
  function load(keyword?: string, sc?: "ciudad" | "provincia", org?: string) {
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams();
    if (keyword) qs.set("keyword", keyword);
    if (sc) qs.set("scope", sc);
    if (org) qs.set("origin", org);
    fetch(`/api/v1/gmb/clients/${id}/competitors${qs.toString() ? `?${qs}` : ""}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error?.message ?? "Error");
        return d;
      })
      .then((d) => {
        setData(d);
        setKw(d.keyword ?? "");
        setScope(d.scope ?? "ciudad");
        setOrigin(d.origin ?? "");
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const search = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const def = scope === "provincia" ? data?.province : data?.city;
        load(kw.trim(), scope, origin.trim() && origin.trim() !== def ? origin.trim() : undefined);
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex-1 min-w-[180px]">
        <span className="block text-[10px] text-slate-500 mb-0.5">Búsqueda (escríbela tal cual en Google)</span>
        <input
          list={`kw-${id}`}
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-[13px]"
          placeholder="p. ej. clínica estética en marbella"
        />
        <datalist id={`kw-${id}`}>
          {(data?.keywords ?? []).map((k: string) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </label>
      <label className="w-44">
        <span className="block text-[10px] text-slate-500 mb-0.5">Buscar desde</span>
        <div className="flex gap-1">
          <select
            value={scope}
            onChange={(e) => {
              const v = e.target.value as "ciudad" | "provincia";
              setScope(v);
              setOrigin((v === "provincia" ? data?.province : data?.city) ?? "");
            }}
            className="border rounded-md px-1 py-1.5 text-[12px]"
          >
            <option value="ciudad">Ciudad</option>
            <option value="provincia">Provincia</option>
          </select>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} className="w-full min-w-0 border rounded-md px-2 py-1.5 text-[13px]" placeholder="Marbella" />
        </div>
      </label>
      <button type="submit" disabled={loading} className="text-[13px] bg-slate-900 text-white rounded-md px-3 py-1.5 disabled:opacity-50">
        {loading ? "Buscando…" : "Actualizar"}
      </button>
    </form>
  );

  if (loading && !data)
    return (
      <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Buscando cómo posiciona Google a la competencia…
      </div>
    );
  if (err && !data)
    return (
      <div className="p-4 space-y-3">
        <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
          {err.includes("Maps") && err.includes("key")
            ? "Falta la Google Maps API key. Configúrala en Ajustes de GMB Hub para ver la competencia."
            : err}
        </div>
      </div>
    );
  if (!data) return null;
  const you = data.yourPosition as number | null;
  return (
    <div className="p-4 space-y-3">
      {search}
      {err && <div className="text-xs text-rose-600">{err}</div>}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={`rounded-lg border p-2 ${you ? (you <= 3 ? "bg-emerald-50 border-emerald-200" : you <= 10 ? "bg-amber-50 border-amber-200" : "bg-rose-50 border-rose-200") : "bg-rose-50 border-rose-200"}`}>
          <div className="text-[10px] text-slate-500">Tu posición</div>
          <div className="text-sm font-semibold">{you ? `#${you}` : `No aparece (top ${data.total})`}</div>
        </div>
        <div className="bg-white rounded-lg border p-2">
          <div className="text-[10px] text-slate-500">Por encima de ti</div>
          <div className="text-sm font-semibold">{data.above}</div>
        </div>
        <div className="bg-white rounded-lg border p-2">
          <div className="text-[10px] text-slate-500">Media top 10</div>
          <div className="text-sm font-semibold">
            {data.market.avgRating?.toFixed(1)}★ · {data.market.avgReviews}
          </div>
        </div>
      </div>
      <div className="text-[11px] text-slate-500">
        Orden de Google Maps para «{data.keyword}» buscando desde {data.scope === "provincia" ? `la provincia de ${data.origin}` : data.origin || "la ciudad del negocio"}.{" "}
        {data.source === "serpapi"
          ? "Ranking real de Google Maps (SerpApi)."
          : "Orden de relevancia de Google Places: muy parecido a Maps, pero puede variar alguna posición. Para el ranking exacto añade la clave de SerpApi en Ajustes."}{" "}
        Google personaliza los resultados según la ubicación exacta de quien busca, así que entre dos móviles puede haber diferencias.
        {" "}Tú: {data.client.rating?.toFixed?.(1) ?? "–"}★ · {data.client.reviewCount} reseñas.
      </div>
      <div className={`space-y-1.5 ${loading ? "opacity-50" : ""}`}>
        {data.competitors.map((c: any) => {
          const isAbove = !c.isYou && (!you || c.position < you);
          return (
            <div
              key={`${c.position}-${c.placeId}`}
              className={`rounded-lg border p-2.5 flex items-center justify-between gap-2 ${c.isYou ? "bg-indigo-50 border-indigo-300" : "bg-white"}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-[12px] font-semibold ${
                    c.isYou ? "bg-indigo-600 text-white" : c.position <= 3 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {c.position}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">
                    {c.name}
                    {c.isYou && <span className="ml-1.5 text-[10px] font-semibold text-indigo-700">TU FICHA</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{c.address}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <div className="text-xs text-slate-700 whitespace-nowrap inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                  {c.rating != null ? c.rating.toFixed(1) : "–"} · {c.reviewCount}
                </div>
                {!c.isYou && (
                  <span className={`text-[10px] font-medium ${isAbove ? "text-rose-600" : "text-emerald-600"}`}>
                    {isAbove ? "Por encima" : "Por debajo"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {!you && data.total > 0 && (
          <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
            Tu ficha no aparece entre los {data.total} primeros resultados para esta búsqueda: todos están por encima.
          </div>
        )}
      </div>
    </div>
  );
}

function GmbSettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<any>(null);
  const [allowed, setAllowed] = useState(true);
  const [webhookToken, setWebhookToken] = useState("");
  const [replyWebhookUrl, setReplyWebhookUrl] = useState("");
  const [mapsKey, setMapsKey] = useState("");
  const [serpApiKey, setSerpApiKey] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [make, setMake] = useState({ templateId: "", gmbConn: "", openaiConn: "", gmailAcct: "", sheetsConn: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/v1/admin/gmb-settings")
      .then((r) => {
        if (r.status === 403) {
          setAllowed(false);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d) {
          setCfg(d);
          setReplyWebhookUrl(d.replyWebhookUrl ?? "");
          setNotifyEmail(d.notifyEmail ?? "");
          if (d.make) setMake({
            templateId: d.make.templateId ?? "",
            gmbConn: d.make.gmbConn ?? "",
            openaiConn: d.make.openaiConn ?? "",
            gmailAcct: d.make.gmailAcct ?? "",
            sheetsConn: d.make.sheetsConn ?? ""
          });
        }
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/gmb-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookToken: webhookToken.trim() || undefined,
          replyWebhookUrl,
          mapsKey: mapsKey.trim() || undefined,
          serpApiKey: serpApiKey.trim() || undefined,
          notifyEmail,
          telegram: telegram.trim() || undefined,
          makeTemplateId: make.templateId,
          makeGmbConn: make.gmbConn,
          makeOpenaiConn: make.openaiConn,
          makeGmailAcct: make.gmailAcct,
          makeSheetsConn: make.sheetsConn
        })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? "Error");
      setMsg("Guardado.");
      setWebhookToken("");
      setMapsKey("");
      setSerpApiKey("");
      setTelegram("");
      const d = await fetch("/api/v1/admin/gmb-settings").then((x) => x.json());
      setCfg(d);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  const ingestUrl = cfg ? `${cfg.incomingWebhookUrl}` : "";

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
          <div className="font-semibold text-sm">Ajustes de GMB Hub</div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {!allowed ? (
          <div className="p-6 text-sm text-slate-500">Solo un administrador puede editar estos ajustes.</div>
        ) : (
          <div className="p-4 space-y-4">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">Entrada de reseñas (configura esto en Make)</div>
              <p className="text-[11px] text-slate-500 mb-1.5">
                En tu escenario de Make, haz un POST a esta URL con el JSON de cada reseña, incluyendo{" "}
                <code>workspaceId</code> y <code>token</code>.
              </p>
              <div className="flex items-center gap-2">
                <input readOnly value={ingestUrl} className="flex-1 px-2 py-1.5 rounded-lg border text-[11px] font-mono bg-slate-50" />
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(ingestUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="h-8 w-8 grid place-items-center rounded-lg border hover:bg-slate-50"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {cfg?.workspaceId && (
                <p className="text-[11px] text-slate-500 mt-1">
                  workspaceId: <code className="font-mono">{cfg.workspaceId}</code>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Token del webhook {cfg?.hasWebhookToken && <span className="text-emerald-600">· configurado ({cfg.webhookTokenMasked})</span>}
              </label>
              <input
                type="password"
                value={webhookToken}
                onChange={(e) => setWebhookToken(e.target.value)}
                placeholder={cfg?.hasWebhookToken ? "•••• (pega uno nuevo para cambiarlo)" : "Inventa un token secreto"}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">URL del webhook de Make para PUBLICAR respuestas en Google</label>
              <input
                value={replyWebhookUrl}
                onChange={(e) => setReplyWebhookUrl(e.target.value)}
                placeholder="https://hook.eu1.make.com/..."
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Google Maps API key {cfg?.hasMapsKey && <span className="text-emerald-600">· configurada</span>}
              </label>
              <input
                type="password"
                value={mapsKey}
                onChange={(e) => setMapsKey(e.target.value)}
                placeholder={cfg?.hasMapsKey ? "•••• guardada" : "Para competencia/ranking"}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                SerpApi key {cfg?.hasSerpApiKey && <span className="text-emerald-600">· configurada{cfg?.serpApiKeyInfo ? ` (${cfg.serpApiKeyInfo})` : ""}</span>}
              </label>
              <input
                type="password"
                value={serpApiKey}
                onChange={(e) => setSerpApiKey(e.target.value)}
                placeholder={cfg?.hasSerpApiKey ? "•••• guardada" : "Para el detector de reseñas falsas (serpapi.com)"}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>

            <div className="pt-3 border-t">
              <div className="text-xs font-semibold text-slate-700 mb-2">Avisos (reseñas negativas, cambios, ranking)</div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email de avisos</label>
              <input
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="info@negociovivo.com (separa varios con comas)"
                className="w-full px-3 py-2 rounded-lg border text-sm mb-2"
              />
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Telegram {cfg?.hasTelegram && <span className="text-emerald-600">· configurado</span>}
              </label>
              <input
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder={cfg?.hasTelegram ? "•••• (botToken:chatId)" : "botToken:chatId"}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>

            <div className="pt-3 border-t">
              <div className="text-xs font-semibold text-slate-700 mb-1">Auto-crear escenario de Make por ficha</div>
              <p className="text-[11px] text-slate-500 mb-2">
                El token/zona/team de Make se configuran en <code>/admin/make-settings</code>. Aquí van los IDs de tu plantilla.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["templateId", "Template Scenario ID"],
                  ["gmbConn", "GMB Connection ID"],
                  ["openaiConn", "OpenAI Connection ID"],
                  ["gmailAcct", "Gmail Account ID"],
                  ["sheetsConn", "Sheets Connection ID"]
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className="block text-[11px] text-slate-600 mb-0.5">{label}</label>
                    <input
                      value={(make as any)[k]}
                      onChange={(e) => setMake((m) => ({ ...m, [k]: e.target.value }))}
                      className="w-full px-2 py-1.5 rounded-lg border text-sm font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
                Guardar
              </button>
              {msg && <span className="text-xs text-slate-600">{msg}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NuevaFicha({ onClose, onCreated, onConnectGoogle }: { onClose: () => void; onCreated: () => void; onConnectGoogle?: () => void }) {
  const [form, setForm] = useState({
    name: "",
    category: "",
    tone: "profesional",
    accountId: "",
    locationId: "",
    emails: ""
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [autofilling, setAutofilling] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);

  async function autofill() {
    if (!url.trim()) {
      setAutoMsg("Pega primero la URL de la ficha de Google.");
      return;
    }
    setAutofilling(true);
    setAutoMsg(null);
    try {
      const r = await fetch("/api/v1/gmb/resolve-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) {
        setAutoMsg(d?.error ?? "No pude leer esa URL.");
        return;
      }
      setForm((f) => ({
        ...f,
        name: d.name || f.name,
        category: d.category || f.category,
        accountId: d.accountId || f.accountId,
        locationId: d.locationId || f.locationId
      }));
      setAutoMsg(
        d.matched
          ? "✓ Rellenado desde Google Business Profile (nombre, categoría e IDs)."
          : d.note ?? "Nombre rellenado."
      );
    } catch {
      setAutoMsg("Error al autocompletar. Inténtalo de nuevo.");
    } finally {
      setAutofilling(false);
    }
  }

  async function save() {
    if (!form.name.trim()) {
      setErr("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/v1/gmb/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error?.message ?? "Error");
      }
      onCreated();
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  const field = (k: keyof typeof form, label: string, placeholder?: string) => (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-semibold text-sm">Nueva ficha GMB</div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {onConnectGoogle && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between gap-3">
              <div className="text-[12px] text-emerald-800">
                Lo más rápido: conéctate con Google y elige tus fichas. Sin copiar IDs.
              </div>
              <button
                type="button"
                onClick={onConnectGoogle}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
              >
                <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-white text-brand-700 text-[10px] font-bold">G</span>
                Conectar con Google
              </button>
            </div>
          )}
          <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3 space-y-2">
            <label className="block text-xs font-medium text-slate-700">
              Autorrellenar desde una URL de Google
            </label>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Pega la URL de la ficha (búsqueda de Google o Maps)"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={autofill}
                disabled={autofilling}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {autofilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Autorrellenar
              </button>
            </div>
            {autoMsg && <p className="text-[11px] text-slate-600">{autoMsg}</p>}
          </div>
          {field("name", "Nombre del negocio *", "Ej: Clínica Aitziber")}
          {field("category", "Categoría", "Ej: Clínica dental")}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Tono de respuesta</label>
            <select
              value={form.tone}
              onChange={(e) => setForm({ ...form, tone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border text-sm"
            >
              <option value="profesional">Profesional</option>
              <option value="cercano">Cercano</option>
              <option value="formal">Formal</option>
              <option value="entusiasta">Entusiasta</option>
            </select>
          </div>
          {field("accountId", "GMB Account ID", "accounts/XXXXX")}
          {field("locationId", "GMB Location ID", "accounts/XXXXX/locations/YYYYY")}
          {field("emails", "Emails de aviso", "info@negociovivo.com")}
          <p className="text-[11px] text-slate-400 inline-flex items-start gap-1">
            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
            Las reseñas se sincronizan vía Make hacia el webhook de GMB del workspace.
          </p>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <button
            onClick={save}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear ficha
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============== Bloque Contenido + IA ============== */

/** Lo que la ficha tiene ahora mismo publicado en Google (fotos o publicaciones). */
function GoogleLive({ id, kind }: { id: string; kind: "photos" | "posts" }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  async function load() {
    setLoading(true);
    const r = await fetch(`/api/v1/gmb/clients/${id}/google-content?kind=${kind}`, { cache: "no-store" });
    setData(await r.json().catch(() => ({ ok: false, message: "Error" })));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id, kind]);
  const items: any[] = (kind === "photos" ? data?.photos : data?.posts) ?? [];
  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-700">
          {kind === "photos" ? "Fotos publicadas en Google" : "Publicaciones en Google"}
          {!loading && data?.ok ? ` (${items.length})` : ""}
        </span>
        <button onClick={load} className="text-[11px] text-brand-600 inline-flex items-center gap-1 hover:underline">
          <RefreshCw className="h-3 w-3" /> Actualizar
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-slate-500 flex items-center gap-2 py-3"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando desde Google…</div>
      ) : !data?.ok ? (
        <div className="text-xs text-slate-500">{data?.message ?? "No se pudo leer de Google."}</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-slate-500">{kind === "photos" ? "La ficha no tiene fotos en Google." : "La ficha no tiene publicaciones en Google."}</div>
      ) : kind === "photos" ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {items.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block group" title={p.category}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt={p.category} loading="lazy" className="w-full aspect-square object-cover rounded-lg border group-hover:opacity-90" />
              <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                {p.format === "VIDEO" ? "🎬 " : ""}{p.category}{p.createTime ? ` · ${fmtDate(p.createTime)}` : ""}
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="border rounded-lg p-2 flex gap-2">
              {p.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt="" loading="lazy" className="h-16 w-16 object-cover rounded-md border shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-slate-500">
                  {({ STANDARD: "Novedad", EVENT: "Evento", OFFER: "Oferta", ALERT: "Aviso" } as any)[p.type] ?? p.type}
                  {p.createTime ? ` · ${fmtDate(p.createTime)}` : ""}
                  {p.state && p.state !== "LIVE" ? ` · ${p.state === "REJECTED" ? "Rechazada" : p.state === "PROCESSING" ? "En revisión" : p.state}` : ""}
                </div>
                {p.event?.title && <div className="text-[13px] font-medium">{p.event.title}</div>}
                <p className={"text-[13px] text-slate-700 whitespace-pre-wrap " + (open === p.id ? "" : "line-clamp-3")}>{p.summary}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {p.summary?.length > 180 && (
                    <button onClick={() => setOpen(open === p.id ? null : p.id)} className="text-[11px] text-brand-600 hover:underline">
                      {open === p.id ? "Ver menos" : "Ver más"}
                    </button>
                  )}
                  {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-[11px] text-brand-600 hover:underline">Ver en Google</a>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PostsPanel({ id }: { id: string }) {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [cta, setCta] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/v1/gmb/clients/${id}/posts`);
    if (r.ok) setPosts((await r.json()).posts ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function generate() {
    setGenBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/generate-posts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: 3 })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setSuggestions(d.posts ?? []);
      if (!d.posts?.length) setMsg("La IA no devolvió publicaciones, prueba otra vez.");
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setGenBusy(false); }
  }

  async function generateImage() {
    const prompt = (content || title).trim();
    if (!prompt) { setMsg("Escribe contenido para generar la imagen."); return; }
    setImgBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/generate-image`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `Foto profesional para publicación de negocio local: ${prompt}`.slice(0, 950) })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setImageUrl(d.url ?? "");
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setImgBusy(false); }
  }

  async function save() {
    if (!content.trim()) { setMsg("El contenido es obligatorio."); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/posts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || undefined, content, cta: cta || undefined,
          imageUrl: imageUrl || undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setTitle(""); setContent(""); setCta(""); setImageUrl(""); setScheduledAt("");
      load();
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setSaving(false); }
  }

  async function del(postId: string) {
    await fetch(`/api/v1/gmb/clients/${id}/posts?postId=${postId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="p-4 space-y-4">
      <GoogleLive id={id} kind="posts" />
      <div className="bg-white rounded-xl border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">Nueva publicación</span>
          <button onClick={generate} disabled={genBusy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-50 border border-brand-200 text-brand-700 text-xs font-medium disabled:opacity-50">
            {genBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Sugerencias IA
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="space-y-1.5">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => { setTitle(s.title ?? ""); setContent(s.content ?? ""); setCta(s.cta ?? ""); setSuggestions([]); }}
                className="block w-full text-left p-2 rounded-lg border border-slate-200 hover:border-brand-300 hover:bg-brand-50/40 text-xs">
                <div className="font-medium text-slate-800">{s.title}</div>
                <div className="text-slate-600 line-clamp-2">{s.content}</div>
                {s.cta && <div className="text-brand-600 mt-0.5">{s.cta}</div>}
              </button>
            ))}
          </div>
        )}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (opcional)"
          className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Contenido de la publicación" rows={3}
          className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
        <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="CTA (ej. Reserva ahora)"
          className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
        <div className="flex items-center gap-2">
          <button onClick={generateImage} disabled={imgBusy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs disabled:opacity-50">
            {imgBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            Imagen IA
          </button>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Calendar className="h-3.5 w-3.5" />
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className="px-2 py-1 rounded-lg border text-xs" />
          </label>
        </div>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-28 rounded-lg object-cover border" />
        )}
        {msg && <p className="text-xs text-slate-500">{msg}</p>}
        <button onClick={save} disabled={saving}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {scheduledAt ? "Programar" : "Guardar borrador"}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 flex items-center gap-2 p-4"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : posts.length === 0 ? (
        <div className="text-sm text-slate-500 text-center p-6 bg-white rounded-xl border">Sin publicaciones todavía.</div>
      ) : (
        posts.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border p-3 flex gap-3">
            {p.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover border shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              {p.title && <div className="text-sm font-medium text-slate-800">{p.title}</div>}
              <div className="text-xs text-slate-600 line-clamp-3">{p.content}</div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-slate-100">{p.status}</span>
                {p.scheduledAt && <span>{new Date(p.scheduledAt).toLocaleString("es-ES")}</span>}
              </div>
            </div>
            <button onClick={() => del(p.id)} className="h-7 w-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function PhotosPanel({ id }: { id: string }) {
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [type, setType] = useState("general");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/v1/gmb/clients/${id}/photos`);
    if (r.ok) setPhotos((await r.json()).photos ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function add() {
    if (!url.trim()) { setMsg("Pega la URL de la imagen."); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/photos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, caption: caption || undefined, type })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setUrl(""); setCaption(""); load();
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setSaving(false); }
  }

  async function del(photoId: string) {
    await fetch(`/api/v1/gmb/clients/${id}/photos?photoId=${photoId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="p-4 space-y-4">
      <GoogleLive id={id} kind="photos" />
      <div className="text-xs font-semibold text-slate-700">Biblioteca del Hub (fotos para programar)</div>
      <div className="bg-white rounded-xl border p-3 space-y-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL de la imagen (https://…)"
          className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
        <div className="flex gap-2">
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Descripción (opcional)"
            className="flex-1 px-2.5 py-1.5 rounded-lg border text-sm" />
          <select value={type} onChange={(e) => setType(e.target.value)} className="px-2 py-1.5 rounded-lg border text-sm">
            <option value="general">General</option>
            <option value="logo">Logo</option>
            <option value="cover">Portada</option>
            <option value="interior">Interior</option>
            <option value="exterior">Exterior</option>
            <option value="producto">Producto</option>
          </select>
        </div>
        {msg && <p className="text-xs text-slate-500">{msg}</p>}
        <button onClick={add} disabled={saving}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Añadir foto
        </button>
      </div>
      {loading ? (
        <div className="text-sm text-slate-500 flex items-center gap-2 p-4"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : photos.length === 0 ? (
        <div className="text-sm text-slate-500 text-center p-6 bg-white rounded-xl border">Sin fotos todavía.</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative group rounded-lg overflow-hidden border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption} className="h-24 w-full object-cover" />
              <button onClick={() => del(p.id)}
                className="absolute top-1 right-1 h-6 w-6 grid place-items-center rounded bg-white/90 text-slate-500 hover:text-rose-500 opacity-0 group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="px-1.5 py-1 text-[10px] text-slate-500 truncate">{p.type}{p.caption ? ` · ${p.caption}` : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QaPanel({ id }: { id: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<{ question: string; answer: string }[]>([]);

  /** Con pregunta escrita: propone la respuesta. Sin pregunta: propone 5 preguntas frecuentes. */
  async function suggest() {
    setSuggesting(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/qa/suggest`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: question.trim() || undefined })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "No se pudo sugerir.");
      if (question.trim()) {
        setQuestion(d.items[0].question);
        setAnswer(d.items[0].answer);
      } else setSuggestions(d.items ?? []);
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setSuggesting(false); }
  }

  async function addSuggestion(sg: { question: string; answer: string }) {
    const r = await fetch(`/api/v1/gmb/clients/${id}/qa`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sg)
    });
    if (r.ok) { setSuggestions((p) => p.filter((x) => x !== sg)); load(); }
    else { const d = await r.json().catch(() => ({})); setMsg(d?.error?.message ?? "Error"); }
  }

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/v1/gmb/clients/${id}/qa`);
    if (r.ok) setItems((await r.json()).items ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function add() {
    if (!question.trim() || !answer.trim()) { setMsg("Pregunta y respuesta son obligatorias."); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/qa`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, answer })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setQuestion(""); setAnswer(""); load();
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setSaving(false); }
  }

  async function del(qaId: string) {
    await fetch(`/api/v1/gmb/clients/${id}/qa?qaId=${qaId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="p-4 space-y-4">
      <div className="bg-white rounded-xl border p-3 space-y-2">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pregunta frecuente"
          className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Respuesta" rows={2}
          className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
        {msg && <p className="text-xs text-slate-500">{msg}</p>}
        <div className="flex gap-2">
          <button onClick={suggest} disabled={suggesting}
            title={question.trim() ? "Escribe la respuesta con IA" : "Propone preguntas frecuentes con IA"}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm hover:bg-slate-50 disabled:opacity-50">
            {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {question.trim() ? "Sugerir respuesta con IA" : "Sugerir preguntas con IA"}
          </button>
          <button onClick={add} disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Añadir
          </button>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="bg-white rounded-xl border-2 border-brand-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Sugerencias de la IA</span>
            <button onClick={() => setSuggestions([])} className="text-[11px] text-slate-500 hover:underline">Descartar</button>
          </div>
          {suggestions.map((sg, i) => (
            <div key={i} className="border rounded-lg p-2 flex gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800">{sg.question}</div>
                <div className="text-xs text-slate-600 mt-0.5">{sg.answer}</div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => addSuggestion(sg)} className="px-2 py-1 rounded-lg bg-brand-600 text-white text-[11px]">Añadir</button>
                <button onClick={() => { setQuestion(sg.question); setAnswer(sg.answer); setSuggestions((p) => p.filter((x) => x !== sg)); }} className="px-2 py-1 rounded-lg border text-[11px]">Editar</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {loading ? (
        <div className="text-sm text-slate-500 flex items-center gap-2 p-4"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-500 text-center p-6 bg-white rounded-xl border">Sin preguntas todavía.</div>
      ) : (
        items.map((q) => (
          <div key={q.id} className="bg-white rounded-xl border p-3 flex gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><HelpCircle className="h-3.5 w-3.5 text-brand-500" />{q.question}</div>
              <div className="text-xs text-slate-600 mt-1">{q.answer}</div>
            </div>
            <button onClick={() => del(q.id)} className="h-7 w-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function TemplatesPanel({ id }: { id: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("positive");
  const [glob, setGlob] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/v1/gmb/clients/${id}/reply-templates`);
    if (r.ok) setItems((await r.json()).items ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function add() {
    if (!name.trim() || !content.trim()) { setMsg("Nombre y contenido son obligatorios."); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/reply-templates`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content, type, global: glob })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setName(""); setContent(""); load();
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setSaving(false); }
  }

  async function del(templateId: string) {
    await fetch(`/api/v1/gmb/clients/${id}/reply-templates?templateId=${templateId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="p-4 space-y-4">
      <div className="bg-white rounded-xl border p-3 space-y-2">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la plantilla"
            className="flex-1 px-2.5 py-1.5 rounded-lg border text-sm" />
          <select value={type} onChange={(e) => setType(e.target.value)} className="px-2 py-1.5 rounded-lg border text-sm">
            <option value="positive">Positiva</option>
            <option value="neutral">Neutra</option>
            <option value="negative">Negativa</option>
          </select>
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Texto de la respuesta" rows={3}
          className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={glob} onChange={(e) => setGlob(e.target.checked)} />
          Plantilla global (para todas las fichas)
        </label>
        {msg && <p className="text-xs text-slate-500">{msg}</p>}
        <button onClick={add} disabled={saving}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Guardar plantilla
        </button>
      </div>
      {loading ? (
        <div className="text-sm text-slate-500 flex items-center gap-2 p-4"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-500 text-center p-6 bg-white rounded-xl border">Sin plantillas todavía.</div>
      ) : (
        items.map((t) => (
          <div key={t.id} className="bg-white rounded-xl border p-3 flex gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                {t.name}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t.type}</span>
                {!t.clientId && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-600">global</span>}
              </div>
              <div className="text-xs text-slate-600 mt-1">{t.content}</div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={() => { navigator.clipboard?.writeText(t.content); setCopied(t.id); setTimeout(() => setCopied(null), 1500); }}
                className="h-7 w-7 grid place-items-center rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50">
                {copied === t.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => del(t.id)} className="h-7 w-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ============== Bloque Alertas y notificaciones ============== */

const NOTIF_LABEL: Record<string, string> = {
  negative_review: "Reseña negativa",
  position_drop: "Caída de ranking",
  profile_change: "Cambio en ficha",
  claimable: "Ficha reclamable",
  info: "Aviso"
};

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    const r = await fetch("/api/v1/gmb/notifications");
    if (r.ok) {
      const d = await r.json();
      setItems(d.items ?? []);
      setUnread(d.unread ?? 0);
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  async function markAll() {
    await fetch("/api/v1/gmb/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    load();
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="relative inline-flex items-center justify-center h-9 w-9 rounded-lg border bg-white hover:bg-slate-50"
        title="Notificaciones"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-rose-500 text-white text-[10px] font-semibold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl border shadow-xl z-50">
          <div className="flex items-center justify-between p-3 border-b sticky top-0 bg-white">
            <span className="text-sm font-semibold">Notificaciones</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs text-brand-600 hover:underline">Marcar leídas</button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">Sin notificaciones</div>
          ) : (
            items.map((n) => (
              <div key={n.id} className={"p-3 border-b last:border-0 " + (n.isRead ? "" : "bg-brand-50/40")}>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="px-1.5 py-0.5 rounded bg-slate-100">{NOTIF_LABEL[n.type] ?? n.type}</span>
                  <span>{new Date(n.createdAt).toLocaleString("es-ES")}</span>
                </div>
                <div className="text-sm font-medium text-slate-800 mt-0.5">{n.title}</div>
                {n.body && <div className="text-xs text-slate-600 line-clamp-3">{n.body}</div>}
                {n.data?.aiDraft && (
                  <div className="mt-1 text-xs text-slate-700 bg-sky-50 rounded p-2 border border-sky-100">
                    <span className="font-medium text-sky-700">Borrador IA: </span>{n.data.aiDraft}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SnapshotButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function scan() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/snapshot`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setMsg(d.isFirst ? "Snapshot inicial guardado" : d.changes?.length ? `${d.changes.length} cambio(s) detectado(s)` : "Sin cambios");
      setTimeout(() => setMsg(null), 3000);
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-1.5">
      {msg && <span className="text-[11px] text-slate-500">{msg}</span>}
      <button onClick={scan} disabled={busy} title="Detectar cambios en la ficha"
        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border bg-white text-xs hover:bg-slate-50 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />}
        Cambios
      </button>
    </div>
  );
}

function CreateScenarioButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function create() {
    if (!confirm("¿Crear el escenario de Make para esta ficha? Clonará tu plantilla y lo activará.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/create-scenario`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setMsg(`Escenario #${d.scenarioId} creado`);
      setTimeout(() => setMsg(null), 4000);
    } catch (e: any) { setMsg(e?.message ?? "Error"); setTimeout(() => setMsg(null), 6000); } finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-1.5">
      {msg && <span className="text-[11px] text-slate-500 max-w-[160px] truncate">{msg}</span>}
      <button onClick={create} disabled={busy} title="Auto-crear escenario de Make"
        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border bg-white text-xs hover:bg-slate-50 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings className="h-3.5 w-3.5" />}
        Make
      </button>
    </div>
  );
}

function EditFichaPanel({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch(`/api/v1/gmb/clients/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.client) setForm(d.client); });
  }, [id]);

  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }

  async function genDescription() {
    setGenBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/generate-description`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      set("description", d.description ?? "");
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setGenBusy(false); }
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const payload: any = {};
      for (const k of ["name", "category", "mainKeyword", "description", "phone", "website", "address", "placeId", "accountId", "locationId", "emails", "tone", "status", "autoReply"]) {
        if (form[k] !== undefined && form[k] !== null) payload[k] = form[k];
      }
      if (form.frequency) payload.frequency = Number(form.frequency);
      const r = await fetch(`/api/v1/gmb/clients/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setMsg("Guardado.");
      setTimeout(() => setMsg(null), 2500);
      onSaved();
    } catch (e: any) { setMsg(e?.message ?? "Error"); } finally { setSaving(false); }
  }

  if (!form) return <div className="p-4 text-sm text-slate-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>;

  const embed = `<iframe src="${origin}/gmb-widget/${id}" style="width:100%;max-width:480px;height:520px;border:0" loading="lazy"></iframe>`;
  const fld = (k: string, label: string, ph?: string) => (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={ph}
        className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {fld("name", "Nombre")}
        {fld("category", "Categoría")}
        {fld("mainKeyword", "Keyword principal", "ej. abogado extranjería Madrid")}
        {fld("phone", "Teléfono")}
        {fld("website", "Sitio web")}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Estado</label>
          <select value={form.status ?? "active"} onChange={(e) => set("status", e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border text-sm">
            <option value="active">Activa</option>
            <option value="paused">Pausada</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Dirección</label>
        <input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-slate-700">Descripción (SEO)</label>
          <button onClick={genDescription} disabled={genBusy}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-brand-50 border border-brand-200 text-brand-700 text-[11px] disabled:opacity-50">
            {genBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Generar IA
          </button>
        </div>
        <textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={4}
          className="w-full px-2.5 py-1.5 rounded-lg border text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fld("placeId", "Place ID", "ChIJ…")}
        {fld("emails", "Emails de aviso")}
        {fld("accountId", "GMB Account ID")}
        {fld("locationId", "GMB Location ID")}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar cambios
        </button>
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
      </div>

      <div className="pt-3 border-t">
        <div className="text-xs font-semibold text-slate-700 mb-1">Widget público de reseñas (pégalo en la web del cliente)</div>
        <div className="flex items-start gap-2">
          <textarea readOnly value={embed} rows={2} className="flex-1 px-2 py-1.5 rounded-lg border text-[11px] font-mono bg-slate-50" />
          <button onClick={() => { navigator.clipboard?.writeText(embed); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="h-8 w-8 grid place-items-center rounded-lg border hover:bg-slate-50 shrink-0">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
