"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { BUSINESS_TYPE_GROUPS, ALL_BUSINESS_TYPES } from "@/lib/leads/business-types";
import { PROVINCE_NAMES } from "@/lib/leads/spain-provinces";
import { municipalitiesForProvince } from "@/lib/leads/spain-municipalities";

// Para saber si el keyword actual coincide con un tipo del desplegable (y
// reflejarlo seleccionado) sin recalcular el array en cada render.
const ALL_BUSINESS_TYPES_SET = new Set(ALL_BUSINESS_TYPES);
import {
  Loader2, Plus, Search, Inbox, ListChecks, BarChart3, MessageCircle,
  Settings as SettingsIcon, Ban, GitBranch, Send, RefreshCw, Download, Play, Pause, Trash2, Pencil, Zap
} from "lucide-react";

type Lead = {
  id: string;
  name: string;
  province: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewsCount: number;
  position: number | null;
  score: number | null;
  urgency: string | null;
  contactStatus: string;
  aiOpener: string | null;
  hasWhatsapp: boolean;
  messagesSent: number;
  nextScheduledAt: string | null;
};

type SearchRow = {
  id: string;
  keyword: string;
  location: string;
  scope: string;
  status: string;
  totalProvinces: number;
  processedProvinces: number;
  currentProvince: string | null;
  totalResults: number;
  errorMessage?: string | null;
  createdAt: string;
  _count?: { leads: number };
};

type Template = { id: string; name: string; body: string; channel: string; isDefault: boolean };

type InboxRow = {
  id: string;
  fromPhone: string;
  body: string;
  classification: string | null;
  classificationConfidence: number | null;
  direction: string;
  read: boolean;
  receivedAt: string;
  lead?: { id: string; name: string; phone: string | null } | null;
};

type QueueRow = {
  id: string;
  leadId: string;
  phoneNormalized: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  sendAttempts: number;
  lastError: string | null;
  renderedMessage: string;
};

type Tab = "leads" | "searches" | "queue" | "inbox" | "sequences" | "templates" | "exclusions" | "analytics" | "map" | "settings";

const CONTACT_STATUSES = [
  { value: "pending", label: "Pendiente", color: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "contacted", label: "Contactado", color: "bg-sky-100 text-sky-800 border-sky-200" },
  { value: "responded", label: "Respondió", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  { value: "client", label: "Cliente", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { value: "excluded", label: "Excluido", color: "bg-rose-50 text-rose-700 border-rose-200" },
  { value: "discarded", label: "Descartado", color: "bg-slate-50 text-slate-500 border-slate-200" }
];

const URGENCY_COLORS: Record<string, string> = {
  critica: "bg-rose-100 text-rose-800 border-rose-200",
  alta: "bg-orange-100 text-orange-800 border-orange-200",
  media: "bg-amber-100 text-amber-800 border-amber-200",
  baja: "bg-slate-100 text-slate-700 border-slate-200",
  descartar: "bg-slate-50 text-slate-400 border-slate-200"
};

export default function LeadsClient() {
  const [tab, setTab] = useState<Tab>("leads");
  const [recoveryInfo, setRecoveryInfo] = useState<{ active: boolean; since: string | null; days: number } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [inboxDiag, setInboxDiag] = useState<{ webhookLastHit: string | null; webhookLastEvent: string | null }>({ webhookLastHit: null, webhookLastEvent: null });
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState("ALL");
  const [searchIdFilter, setSearchIdFilter] = useState("ALL");
  const [searchQ, setSearchQ] = useState("");
  const [newSearchOpen, setNewSearchOpen] = useState(false);
  const [newTemplateOpen, setNewTemplateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      if (tab === "leads") {
        const q = new URLSearchParams();
        if (statusFilter !== "ALL") q.set("contactStatus", statusFilter);
        if (urgencyFilter !== "ALL") q.set("urgency", urgencyFilter);
        if (searchIdFilter !== "ALL") q.set("searchId", searchIdFilter);
        if (searchQ) q.set("search", searchQ);
        const [leadsRes, searchesRes] = await Promise.all([
          fetch(`/api/v1/leads?${q.toString()}`),
          fetch("/api/v1/leads/searches")
        ]);
        if (leadsRes.ok) setLeads((await leadsRes.json()).items ?? []);
        if (searchesRes.ok) setSearches((await searchesRes.json()).items ?? []);
      } else if (tab === "searches") {
        const r = await fetch("/api/v1/leads/searches");
        if (r.ok) setSearches((await r.json()).items ?? []);
      } else if (tab === "queue") {
        const r = await fetch("/api/v1/leads/queue");
        if (r.ok) setQueue((await r.json()).items ?? []);
      } else if (tab === "templates") {
        const r = await fetch("/api/v1/leads/templates");
        if (r.ok) setTemplates((await r.json()).items ?? []);
      } else if (tab === "inbox") {
        const r = await fetch("/api/v1/leads/inbox");
        if (r.ok) {
          const d = await r.json();
          setInbox(d.items ?? []);
          setInboxDiag(d.diagnostics ?? { webhookLastHit: null, webhookLastEvent: null });
        }
      } else if (tab === "analytics") {
        const r = await fetch("/api/v1/leads/analytics");
        if (r.ok) setAnalytics(await r.json());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter, urgencyFilter, searchIdFilter, searchQ]);

  // Carga el estado del modo recuperación una vez para el banner anti-baneo.
  useEffect(() => {
    fetch("/api/v1/leads/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        d &&
        setRecoveryInfo({
          active: !!d.recoveryMode,
          since: d.recoverySince ?? null,
          days: d.recoveryDurationDays ?? 14
        })
      )
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Leads (NV Leads Pro)"
        description="Captación Google Places + envíos WhatsApp + secuencias + clasificación IA"
        actions={
          <>
            {tab === "searches" && (
              <button
                onClick={() => setNewSearchOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Nueva búsqueda
              </button>
            )}
            {tab === "templates" && (
              <button
                onClick={() => setNewTemplateOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Nueva plantilla
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
              title="Ajustes de Google Places, WAHA y envío"
            >
              <SettingsIcon className="h-4 w-4" />
              Ajustes
            </button>
          </>
        }
      />

      {/* Tabs reorderables: cada usuario guarda en localStorage el orden que
          prefiera. Para mover una pestaña: arrástrala hacia la izquierda o
          la derecha sobre las demás. */}
      {recoveryInfo?.active && recoveryInfo.since && (() => {
        const exp = new Date(new Date(recoveryInfo.since).getTime() + recoveryInfo.days * 86_400_000);
        const daysLeft = Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86_400_000));
        return (
          <div className="mb-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 text-xs">
            🛡 <strong>Modo recuperación activo</strong> — quedan {daysLeft} día{daysLeft === 1 ? "" : "s"} con
            límites endurecidos (máx 15/día · 3/hora · 8 nuevas convos/día · cool-down 10 días · delay 5-15 min).
            Se desactiva solo el {exp.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}.
          </div>
        );
      })()}
      <DraggableTabs tab={tab} setTab={setTab} />

      {/* Contenido por tab */}
      {tab === "leads" && (
        <>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <input
              type="search"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Buscar por nombre, provincia, teléfono..."
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border bg-white text-sm"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-white text-sm"
            >
              <option value="ALL">Todos los estados</option>
              {CONTACT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <select
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-white text-sm"
            >
              <option value="ALL">Toda urgencia</option>
              <option value="critica">Crítica</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
              <option value="descartar">Descartar</option>
            </select>
            <select
              value={searchIdFilter}
              onChange={(e) => setSearchIdFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-white text-sm max-w-[260px]"
              title="Filtrar por búsqueda realizada"
            >
              <option value="ALL">Todas las búsquedas</option>
              {searches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.keyword}
                  {s.location ? ` · ${s.location}` : ""}
                  {s._count?.leads != null ? ` (${s._count.leads})` : ""}
                </option>
              ))}
            </select>
            <a
              href={`/api/v1/leads/export${searchIdFilter !== "ALL" ? `?searchId=${searchIdFilter}` : ""}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
          <LeadsTable loading={loading} items={leads} onChanged={load} />
        </>
      )}

      {tab === "searches" && <SearchesTable loading={loading} items={searches} onChanged={load} />}
      {tab === "queue" && <QueueTable loading={loading} items={queue} onChanged={load} />}
      {tab === "inbox" && <InboxList loading={loading} items={inbox} diagnostics={inboxDiag} />}
      {tab === "sequences" && <SequencesView />}
      {tab === "templates" && <TemplatesTable loading={loading} items={templates} onChanged={load} />}
      {tab === "exclusions" && <ExclusionsView />}
      {tab === "analytics" && <AnalyticsView data={analytics} loading={loading} />}
      {tab === "map" && <LeadsMapView />}

      <NewSearchModal open={newSearchOpen} onClose={() => setNewSearchOpen(false)} onSaved={load} />
      <TemplateModal open={newTemplateOpen} template={null} onClose={() => setNewTemplateOpen(false)} onSaved={load} />
      <LeadsSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

/** Botón compacto para cambiar masivamente el contactStatus de N leads
 *  desde la pestaña Leads. Pide confirmación y delega en POST
 *  /api/v1/leads/bulk-status. Usado para Excluir y Descartar. */
function BulkStatusButton({
  ids,
  status,
  label,
  onDone
}: {
  ids: string[];
  status: "excluded" | "discarded";
  label: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (ids.length === 0) return;
    if (!confirm(`¿${label.toLowerCase()} ${ids.length} lead(s)? Quedarán fuera de la cola de envío.`)) return;
    setBusy(true);
    try {
      await fetch("/api/v1/leads/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids, contactStatus: status })
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={run}
      disabled={busy}
      className={
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50 " +
        (status === "excluded"
          ? "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
          : "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200")
      }
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
      {label}
    </button>
  );
}

/** Pestaña Mapa: muestra todos los leads con coordenadas en un mapa
 *  Leaflet/OpenStreetMap. Carga Leaflet dinámicamente desde CDN para no
 *  añadir dependencias al bundle.
 *
 *  Color del marker por urgencia: rojo=crítica, naranja=alta, ámbar=media,
 *  azul=baja. Click muestra nombre + teléfono + score. */
function LeadsMapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: any = null;

    async function loadLeaflet(): Promise<any> {
      const w = window as any;
      if (w.L) return w.L;
      // CSS
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      // JS
      await new Promise<void>((resolve, reject) => {
        if (w.L) return resolve();
        const script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar Leaflet"));
        document.body.appendChild(script);
      });
      return (window as any).L;
    }

    (async () => {
      try {
        const [leads, L] = await Promise.all([
          fetch("/api/v1/leads?limit=500").then((r) => (r.ok ? r.json() : { items: [] })),
          loadLeaflet()
        ]);
        if (cancelled || !containerRef.current) return;
        const items: any[] = leads.items ?? [];
        const geo = items.filter((l) => l.latitude != null && l.longitude != null);
        // Centrar en la media; si no hay puntos, en Madrid.
        const center =
          geo.length > 0
            ? [
                geo.reduce((s, l) => s + l.latitude, 0) / geo.length,
                geo.reduce((s, l) => s + l.longitude, 0) / geo.length
              ]
            : [40.4168, -3.7038];
        map = L.map(containerRef.current).setView(center, geo.length > 0 ? 6 : 5);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
          maxZoom: 19
        }).addTo(map);
        const URG_COLOR: Record<string, string> = {
          critica: "#dc2626",
          alta: "#ea580c",
          media: "#d97706",
          baja: "#0284c7",
          descartar: "#94a3b8"
        };
        for (const l of geo) {
          const color = URG_COLOR[l.urgency ?? ""] ?? "#475569";
          const marker = L.circleMarker([l.latitude, l.longitude], {
            radius: 7,
            color,
            fillColor: color,
            fillOpacity: 0.7,
            weight: 1.5
          }).addTo(map);
          const popup = `
            <strong>${escapeHtmlClient(l.name)}</strong><br/>
            ${l.province ?? ""}<br/>
            ${l.phone ?? "Sin teléfono"}<br/>
            <span style="color:${color}">★ ${l.rating ?? "—"}</span> ·
            Score ${l.score ?? "—"} ·
            ${l.urgency ?? "—"}
          `;
          marker.bindPopup(popup);
        }
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Error cargando el mapa");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, []);

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Vista geográfica de los leads con coordenadas. Color del marker según urgencia.
      </p>
      {error && (
        <div className="text-xs px-3 py-2 rounded border border-rose-200 bg-rose-50 text-rose-700">{error}</div>
      )}
      {loading && !error && (
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando mapa…
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-[600px] rounded-xl border bg-slate-50"
      />
    </div>
  );
}

function escapeHtmlClient(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Botón one-shot para purgar el campo aiOpener legacy de todos los leads
 *  del workspace. Los openers vinieron del plugin WordPress y mostraban
 *  datos obsoletos al re-buscar; este botón los borra y deja los mensajes
 *  con {{opener_ia}} vacío. Útil tras los fixes recientes del template. */
function CleanupOpenerButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  async function run() {
    if (!confirm("¿Borrar el opener IA legacy (heredado del plugin WordPress) de TODOS los leads? Los mensajes encolados después ya no incluirán esa frase obsoleta.")) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/v1/leads/cleanup-ai-opener", { method: "POST" });
      const j = await r.json();
      if (r.ok) setResult(`✓ ${j.updated ?? 0} leads limpiados.`);
      else setResult(`✗ ${j?.error?.message ?? `Error ${r.status}`}`);
    } catch (e: any) {
      setResult(`✗ ${e?.message ?? "Error de red"}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1">
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Limpiar openers heredados del plugin WordPress
      </button>
      <p className="text-[11px] text-slate-500">
        Una sola vez: borra el campo <code>aiOpener</code> obsoleto de todos los leads del workspace.
      </p>
      {result && <p className={"text-[11px] " + (result.startsWith("✓") ? "text-emerald-700" : "text-rose-700")}>{result}</p>}
    </div>
  );
}

function TabBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition " +
        (active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50")
      }
    >
      {icon}
      {label}
    </button>
  );
}

/** Definición fija de pestañas. El orden visible se persiste por usuario en
 *  localStorage ("leads.tabOrder"); este array solo aporta el catálogo. */
const LEADS_TAB_DEFS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "leads",      label: "Leads",       icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { key: "searches",   label: "Búsquedas",   icon: <Search className="h-3.5 w-3.5" /> },
  { key: "queue",      label: "Cola envío",  icon: <Send className="h-3.5 w-3.5" /> },
  { key: "inbox",      label: "Inbox",       icon: <Inbox className="h-3.5 w-3.5" /> },
  { key: "sequences",  label: "Secuencias",  icon: <GitBranch className="h-3.5 w-3.5" /> },
  { key: "templates",  label: "Plantillas",  icon: <ListChecks className="h-3.5 w-3.5" /> },
  { key: "exclusions", label: "Exclusiones", icon: <Ban className="h-3.5 w-3.5" /> },
  { key: "analytics",  label: "Analytics",   icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { key: "map",        label: "Mapa",        icon: <Search className="h-3.5 w-3.5" /> }
];
const LEADS_TAB_ORDER_KEY = "leads.tabOrder";

function DraggableTabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const allKeys = LEADS_TAB_DEFS.map((t) => t.key);
  const [order, setOrder] = useState<Tab[]>(allKeys);
  const [dragKey, setDragKey] = useState<Tab | null>(null);

  // Carga orden guardado al montar y reconcilia con las pestañas existentes
  // (por si añadimos/quitamos pestañas en el futuro).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEADS_TAB_ORDER_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Tab[];
      if (!Array.isArray(saved)) return;
      const set = new Set(allKeys);
      const kept = saved.filter((k) => set.has(k));
      const missing = allKeys.filter((k) => !kept.includes(k));
      setOrder([...kept, ...missing] as Tab[]);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(next: Tab[]) {
    setOrder(next);
    try {
      localStorage.setItem(LEADS_TAB_ORDER_KEY, JSON.stringify(next));
    } catch {}
  }

  function onDragStart(e: React.DragEvent, key: Tab) {
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function onDrop(e: React.DragEvent, targetKey: Tab) {
    e.preventDefault();
    const src = (dragKey ?? e.dataTransfer.getData("text/plain")) as Tab;
    setDragKey(null);
    if (!src || src === targetKey) return;
    const next = order.filter((k) => k !== src);
    const idx = next.indexOf(targetKey);
    next.splice(idx, 0, src);
    persist(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mb-4 bg-white border rounded-lg p-1">
      {order.map((key) => {
        const def = LEADS_TAB_DEFS.find((d) => d.key === key);
        if (!def) return null;
        const active = tab === key;
        return (
          <div
            key={key}
            draggable
            onDragStart={(e) => onDragStart(e, key)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, key)}
            onDragEnd={() => setDragKey(null)}
            className={dragKey === key ? "opacity-50" : ""}
            title="Arrástrame para reordenar"
          >
            <TabBtn icon={def.icon} label={def.label} active={active} onClick={() => setTab(key)} />
          </div>
        );
      })}
    </div>
  );
}

// ============ LEADS ============

function LeadsTable({ loading, items, onChanged }: { loading: boolean; items: Lead[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enqueueOpen, setEnqueueOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);

  // Al refrescar/filtrar, descarta de la selección los leads que ya no salen.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(items.map((l) => l.id));
      const next = new Set<string>();
      prev.forEach((id) => ids.has(id) && next.add(id));
      return next;
    });
  }, [items]);

  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin leads. Crea una búsqueda para captar." />;

  const canContact = (l: Lead) => !!l.phone && !["excluded", "discarded"].includes(l.contactStatus);
  const contactable = items.filter(canContact);
  const allSelected = contactable.length > 0 && contactable.every((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(contactable.map((l) => l.id)));
  }

  return (
    <div className="space-y-2">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
          <span className="text-sm text-brand-800 font-medium">{selected.size} lead(s) seleccionados</span>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-600 hover:underline">
              Quitar selección
            </button>
            <BulkStatusButton ids={Array.from(selected)} status="excluded" label="Excluir" onDone={onChanged} />
            <BulkStatusButton ids={Array.from(selected)} status="discarded" label="Descartar" onDone={onChanged} />
            <a
              href={`/api/v1/leads/export?ids=${Array.from(selected).join(",")}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm"
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </a>
            <button
              onClick={() => setEnrollOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm font-medium"
            >
              <GitBranch className="h-4 w-4" />
              Añadir a secuencia
            </button>
            <button
              onClick={() => setEnqueueOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Send className="h-4 w-4" />
              Encolar WhatsApp
            </button>
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-brand-600" title="Seleccionar contactables" />
              </th>
              <th className="text-left px-3 py-2.5">Negocio</th>
              <th className="text-left px-3 py-2.5">Provincia</th>
              <th className="text-left px-3 py-2.5">Teléfono</th>
              <th className="text-left px-3 py-2.5">Pos</th>
              <th className="text-left px-3 py-2.5">Rating</th>
              <th className="text-left px-3 py-2.5">Score</th>
              <th className="text-left px-3 py-2.5">Urgencia</th>
              <th className="text-left px-3 py-2.5">WA</th>
              <th className="text-left px-3 py-2.5" title="Próximo mensaje programado para este lead">Próximo</th>
              <th className="text-left px-3 py-2.5" title="Mensajes WhatsApp enviados a este lead">Enviados</th>
              <th className="text-left px-3 py-2.5">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((l) => {
              const st = CONTACT_STATUSES.find((s) => s.value === l.contactStatus) ?? CONTACT_STATUSES[0];
              const urg = l.urgency ? URGENCY_COLORS[l.urgency] : "";
              const rowContactable = canContact(l);
              return (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      disabled={!rowContactable}
                      checked={selected.has(l.id)}
                      onChange={() => toggle(l.id)}
                      className="accent-brand-600 disabled:opacity-30"
                      title={rowContactable ? "" : "Sin teléfono o excluido/descartado"}
                    />
                  </td>
                  <td className="px-3 py-2 max-w-xs truncate font-medium" title={l.name}>
                    <button
                      type="button"
                      onClick={() => setDetailLeadId(l.id)}
                      className="text-left hover:text-brand-700 hover:underline truncate"
                    >
                      {l.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{l.province ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.phone ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{l.position ?? "—"}</td>
                  <td className="px-3 py-2">{l.rating != null ? `★ ${l.rating}` : "—"} <span className="text-[10px] text-slate-500">({l.reviewsCount})</span></td>
                  <td className="px-3 py-2 font-semibold">{l.score ?? "—"}</td>
                  <td className="px-3 py-2">
                    {l.urgency && (
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${urg}`}>{l.urgency}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">{l.hasWhatsapp ? "✓" : "—"}</td>
                  <td className="px-3 py-2">
                    {l.nextScheduledAt ? (
                      <span className="text-[11px] text-slate-600" title={new Date(l.nextScheduledAt).toLocaleString("es-ES")}>
                        {new Date(l.nextScheduledAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {l.messagesSent > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800"
                        title={`${l.messagesSent} mensaje${l.messagesSent === 1 ? "" : "s"} enviado${l.messagesSent === 1 ? "" : "s"}`}
                      >
                        <Send className="h-2.5 w-2.5" />
                        {l.messagesSent}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${st.color}`}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <EnqueueModal
        open={enqueueOpen}
        onClose={() => setEnqueueOpen(false)}
        leadIds={Array.from(selected)}
        onDone={() => {
          setEnqueueOpen(false);
          setSelected(new Set());
          onChanged();
        }}
      />
      <EnrollModal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        leadIds={Array.from(selected)}
        onDone={() => {
          setEnrollOpen(false);
          setSelected(new Set());
          onChanged();
        }}
      />
      <LeadDetailModal
        open={detailLeadId !== null}
        leadId={detailLeadId}
        onClose={() => setDetailLeadId(null)}
      />
    </div>
  );
}

function LeadDetailModal({
  open,
  leadId,
  onClose
}: {
  open: boolean;
  leadId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !leadId) return;
    setLoading(true);
    fetch(`/api/v1/leads/${leadId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [open, leadId]);

  const lead = data?.lead;
  const timeline = data?.timeline ?? [];

  return (
    <Modal open={open} onClose={onClose} title={lead?.name ?? "Lead"} size="xl">
      {loading || !lead ? (
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><span className="text-slate-500">Teléfono:</span> <span className="font-mono">{lead.phone ?? "—"}</span></div>
            <div><span className="text-slate-500">Web:</span> {lead.website ? <a href={lead.website} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">abrir ↗</a> : "—"}</div>
            <div><span className="text-slate-500">Provincia:</span> {lead.province ?? "—"}</div>
            <div><span className="text-slate-500">Posición:</span> {lead.position ?? "—"}</div>
            <div><span className="text-slate-500">Rating:</span> {lead.rating != null ? `★ ${lead.rating} (${lead.reviewsCount})` : "—"}</div>
            <div><span className="text-slate-500">Score:</span> <span className="font-semibold">{lead.score ?? "—"}</span></div>
            <div><span className="text-slate-500">Urgencia:</span> {lead.urgency ?? "—"}</div>
            <div><span className="text-slate-500">Estado:</span> {lead.contactStatus}</div>
          </div>
          {lead.search && (
            <div className="text-[11px] text-slate-500">
              Búsqueda: <code>{lead.search.keyword}</code> · {lead.search.location}
            </div>
          )}
          {lead.notes && (
            <div className="text-xs px-3 py-2 rounded-md bg-slate-50 border text-slate-700">{lead.notes}</div>
          )}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Conversación ({timeline.length} mensaje{timeline.length === 1 ? "" : "s"})
            </h3>
            {timeline.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Sin mensajes todavía.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {timeline.map((m: any, i: number) => (
                  <div
                    key={i}
                    className={
                      "rounded-lg p-2.5 text-xs border " +
                      (m.kind === "out"
                        ? "bg-emerald-50 border-emerald-200 ml-8"
                        : "bg-white border-slate-200 mr-8")
                    }
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                        {m.kind === "out" ? "Saliente" : "Entrante"}
                        {m.classification ? ` · ${m.classification}` : ""}
                        {m.status ? ` · ${m.status}` : ""}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {m.ts ? new Date(m.ts).toLocaleString("es-ES") : "—"}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap leading-snug">{m.message}</div>
                    {m.lastError && (
                      <div className="mt-1 text-[11px] text-rose-700">⚠ {m.lastError}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function EnrollModal({
  open,
  onClose,
  leadIds,
  onDone
}: {
  open: boolean;
  onClose: () => void;
  leadIds: string[];
  onDone: () => void;
}) {
  const [sequences, setSequences] = useState<any[]>([]);
  const [sequenceId, setSequenceId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    fetch("/api/v1/leads/sequences")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const items: any[] = (d.items ?? []).filter((s: any) => s.active !== false);
        setSequences(items);
        const def = items.find((s) => s.isDefault) ?? items[0];
        setSequenceId(def?.id ?? "");
      })
      .catch(() => setSequences([]));
  }, [open]);

  async function submit() {
    if (!sequenceId) return;
    setBusy(true);
    setError(null);
    let ok = 0;
    let failed = 0;
    // Secuencial: cada enroll encola su primer paso (con espaciado anti-baneo).
    for (const leadId of leadIds) {
      try {
        const r = await fetch("/api/v1/leads/sequences/enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, sequenceId })
        });
        if (r.ok) ok++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    setResult({ ok, failed, total: leadIds.length });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Añadir ${leadIds.length} lead(s) a una secuencia`}>
      {!result ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Los leads entran en la secuencia y reciben cada paso con su retraso. Se detiene sola si el lead responde.
          </p>
          <label className="block text-sm font-medium text-slate-700">Secuencia</label>
          {sequences.length === 0 ? (
            <p className="text-sm text-amber-700">No hay secuencias. Créala en la pestaña <strong>Secuencias</strong>.</p>
          ) : (
            <select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-white text-sm">
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.steps?.length ?? 0} pasos){s.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
            <button onClick={submit} disabled={busy || !sequenceId} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
              Enrolar {leadIds.length}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <strong className="text-emerald-700">{result.ok}</strong> enrolados de {result.total}.
            {result.failed > 0 && <span className="text-amber-700"> {result.failed} fallidos (ya enrolados, sin teléfono o excluidos).</span>}
          </p>
          <div className="flex justify-end">
            <button onClick={onDone} className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">Hecho</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function EnqueueModal({
  open,
  onClose,
  leadIds,
  onDone
}: {
  open: boolean;
  onClose: () => void;
  leadIds: string[];
  onDone: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; skipped: { leadId: string; reason: string }[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    fetch("/api/v1/leads/templates")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const items: Template[] = d.items ?? [];
        setTemplates(items);
        const def = items.find((t) => t.isDefault) ?? items[0];
        setTemplateId(def?.id ?? "");
      })
      .catch(() => setTemplates([]));
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/leads/queue/enqueue-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds, templateId: templateId || null })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Encolar WhatsApp a ${leadIds.length} lead(s)`}>
      {!result ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Se encolarán con el <strong>espaciado anti-baneo</strong> de Ajustes (ventana horaria, delay aleatorio entre envíos y tope diario). Cada mensaje se personaliza y se le aplican micro-variaciones por lead.
          </p>
          <label className="block text-sm font-medium text-slate-700">Plantilla</label>
          {templates.length === 0 ? (
            <p className="text-sm text-amber-700">No hay plantillas todavía. Crea una en la pestaña <strong>Plantillas</strong>.</p>
          ) : (
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? " (por defecto)" : ""}
                </option>
              ))}
            </select>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={busy || templates.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Encolar {leadIds.length}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <strong className="text-emerald-700">{result.ok}</strong> encolados de {result.total}.
            {result.skipped.length > 0 && <span className="text-amber-700"> {result.skipped.length} omitidos.</span>}
          </p>
          {result.skipped.length > 0 && (
            <div className="max-h-40 overflow-y-auto text-xs bg-slate-50 border rounded p-2 space-y-0.5">
              {result.skipped.slice(0, 50).map((s) => (
                <div key={s.leadId}>
                  <code>{s.leadId.slice(0, 8)}</code>: {s.reason}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={onDone} className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
              Hecho
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ============ BÚSQUEDAS ============

function SearchesTable({ loading, items, onChanged }: { loading: boolean; items: SearchRow[]; onChanged: () => void }) {
  const [runningAllId, setRunningAllId] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin búsquedas. Pulsa 'Nueva búsqueda' arriba." />;
  async function process(id: string) {
    await fetch(`/api/v1/leads/searches/${id}/process`, { method: "POST" });
    onChanged();
  }
  /** Encadena llamadas a /process hasta que la búsqueda quede COMPLETED o FAILED.
   *  Útil para escaneos de toda España: el usuario pulsa una vez y se procesan
   *  los 52 batches automáticamente. */
  async function processAll(id: string) {
    setRunningAllId(id);
    try {
      // Cota dura por si el endpoint nunca señala "pending=0" (no quedar en bucle).
      for (let i = 0; i < 60; i++) {
        const r = await fetch(`/api/v1/leads/searches/${id}/process`, { method: "POST" });
        if (!r.ok) break;
        const d = await r.json().catch(() => ({}));
        onChanged();
        if (d?.pending === 0 || d?.status === "COMPLETED" || d?.status === "FAILED") break;
        // Pequeña pausa para no saturar Google Places ni dar la sensación de cuelgue.
        await new Promise((res) => setTimeout(res, 500));
      }
    } finally {
      setRunningAllId(null);
      onChanged();
    }
  }
  return (
    <div className="bg-white rounded-xl border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-3 py-2.5">Keyword</th>
            <th className="text-left px-3 py-2.5">Localidad</th>
            <th className="text-left px-3 py-2.5">Alcance</th>
            <th className="text-left px-3 py-2.5">Progreso</th>
            <th className="text-left px-3 py-2.5">Leads</th>
            <th className="text-left px-3 py-2.5">Estado</th>
            <th className="text-right px-3 py-2.5">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((s) => {
            const pending = s.status !== "COMPLETED" && s.status !== "FAILED";
            const pct = s.totalProvinces > 0 ? Math.round((s.processedProvinces / s.totalProvinces) * 100) : 0;
            return (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{s.keyword}</td>
                <td className="px-3 py-2 text-slate-600">{s.location}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{s.scope === "spain" ? "Toda España" : "Provincia"}</td>
                <td className="px-3 py-2 min-w-[160px]">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] text-slate-500 whitespace-nowrap">
                      {s.processedProvinces}/{s.totalProvinces}
                    </span>
                  </div>
                  {s.currentProvince && <div className="text-[10px] text-slate-400 mt-0.5">en {s.currentProvince}</div>}
                </td>
                <td className="px-3 py-2 font-semibold">{s.totalResults}</td>
                <td className="px-3 py-2 text-xs">
                  <span
                    className={
                      s.status === "FAILED"
                        ? "inline-block px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200"
                        : ""
                    }
                  >
                    {s.status}
                  </span>
                  {s.status === "FAILED" && s.errorMessage && (
                    <div
                      className="mt-1 text-[11px] text-rose-700 max-w-[320px] whitespace-pre-wrap leading-snug"
                      title={s.errorMessage}
                    >
                      {s.errorMessage}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {pending && (
                    <>
                      <button
                        onClick={() => process(s.id)}
                        disabled={runningAllId === s.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-xs disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" />
                        Procesar batch
                      </button>
                      {s.scope === "spain" && (
                        <button
                          onClick={() => processAll(s.id)}
                          disabled={runningAllId === s.id}
                          className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded border bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700 text-xs disabled:opacity-50"
                          title="Procesar todas las provincias restantes seguidas"
                        >
                          {runningAllId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Procesar todo
                        </button>
                      )}
                    </>
                  )}
                  <a
                    href={`/api/v1/leads/export?searchId=${s.id}`}
                    className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded border bg-white hover:bg-slate-50 text-xs"
                  >
                    <Download className="h-3 w-3" />
                    CSV
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============ COLA DE ENVÍO ============

function QueueTable({ loading, items, onChanged }: { loading: boolean; items: QueueRow[]; onChanged: () => void }) {
  const [processing, setProcessing] = useState(false);
  const [tickResult, setTickResult] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [sendingNowId, setSendingNowId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Al refrescar, descarta de la selección los que ya no salen.
  useEffect(() => {
    const present = new Set(items.map((m) => m.id));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (present.has(id)) next.add(id);
      return next;
    });
  }, [items]);

  const deletable = items.filter((m) => m.status !== "sending");
  const allSelected = deletable.length > 0 && deletable.every((m) => selected.has(m.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(deletable.map((m) => m.id)));
  }

  async function tick() {
    setProcessing(true);
    setTickResult(null);
    try {
      const r = await fetch("/api/v1/leads/queue/process", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTickResult({ kind: "error", text: d?.message ?? `Error HTTP ${r.status}` });
      } else if (d?.processed && d?.status === "sent") {
        setTickResult({ kind: "ok", text: "✓ Mensaje enviado." });
      } else if (d?.processed && d?.status === "no_whatsapp") {
        setTickResult({ kind: "warn", text: "Número sin WhatsApp — descartado." });
      } else if (d?.processed && d?.status === "failed") {
        setTickResult({ kind: "error", text: `Envío falló: ${d?.error ?? "sin detalle"}` });
      } else {
        const code = d?.error as string | undefined;
        const reasons: Record<string, string> = {
          queue_paused: "La cola está pausada o desactivada en Ajustes.",
          outside_window: "Fuera de la ventana horaria configurada (Ajustes → Envío).",
          daily_limit_reached: "Tope diario alcanzado.",
          hourly_limit_reached: "Tope POR HORA alcanzado (anti-baneo). Vuelve a la próxima hora.",
          recipient_cooldown: "Este número recibió un mensaje hace poco; reprogramado tras el cool-down configurado.",
          new_chats_daily_cap: "Tope de NUEVAS conversaciones por hoy alcanzado. Reprogramado para mañana.",
          pacing_wait: "Aún no toca: hay que esperar el delay mínimo desde el último envío."
        };
        const human = code && reasons[code] ? reasons[code] : code
          ? `No procesado: ${code}`
          : "Nada que procesar ahora (revisa la fecha programada de los mensajes).";
        setTickResult({ kind: "warn", text: human });
      }
    } catch (e: any) {
      setTickResult({ kind: "error", text: e?.message ?? "Error de red" });
    } finally {
      setProcessing(false);
      onChanged();
    }
  }
  async function retryFailed() {
    const failedCount = items.filter((m) => m.status === "failed").length;
    if (
      !confirm(
        `¿Reintentar ${failedCount} mensaje(s) fallido(s)? Se vuelven a encolar y se re-habilitan los leads que se descartaron por "Número sin WhatsApp".`
      )
    )
      return;
    setProcessing(true);
    setTickResult(null);
    try {
      const r = await fetch("/api/v1/leads/queue/retry-failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTickResult({ kind: "error", text: d?.message ?? `Error HTTP ${r.status}` });
      } else {
        setTickResult({
          kind: "ok",
          text: `✓ ${d.requeued ?? 0} mensaje(s) re-encolado(s), ${d.leadsReset ?? 0} lead(s) re-habilitado(s). Pulsa "Procesar siguiente" para enviarlos.`
        });
      }
    } catch (e: any) {
      setTickResult({ kind: "error", text: e?.message ?? "Error de red" });
    } finally {
      setProcessing(false);
      onChanged();
    }
  }
  async function sendNow(id: string) {
    if (!confirm("¿Enviar ESTE mensaje ahora mismo? Se salta la ventana horaria y el delay anti-spam.")) return;
    setSendingNowId(id);
    setTickResult(null);
    try {
      const r = await fetch(`/api/v1/leads/queue/${id}/send-now`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTickResult({ kind: "error", text: d?.message ?? `Error HTTP ${r.status}` });
      } else if (d?.status === "sent") {
        setTickResult({ kind: "ok", text: "✓ Mensaje enviado." });
      } else if (d?.status === "no_whatsapp") {
        setTickResult({ kind: "warn", text: "Número sin WhatsApp — descartado." });
      } else if (d?.status === "failed" || d?.status === "retry") {
        setTickResult({ kind: "error", text: `Envío falló: ${d?.error ?? "sin detalle"}` });
      } else {
        setTickResult({ kind: "warn", text: d?.error ?? "No procesado." });
      }
    } catch (e: any) {
      setTickResult({ kind: "error", text: e?.message ?? "Error de red" });
    } finally {
      setSendingNowId(null);
      onChanged();
    }
  }
  async function removeOne(id: string) {
    if (!confirm("¿Borrar este mensaje de la cola? No se enviará.")) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/v1/leads/queue/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.message ?? "No se pudo borrar.");
      }
      onChanged();
    } finally {
      setDeletingId(null);
    }
  }
  async function removeSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`¿Borrar ${ids.length} mensaje${ids.length === 1 ? "" : "s"} de la cola? No se enviarán.`)) return;
    setBulkDeleting(true);
    try {
      const r = await fetch("/api/v1/leads/queue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.message ?? "No se pudieron borrar.");
      }
      setSelected(new Set());
      onChanged();
    } finally {
      setBulkDeleting(false);
    }
  }

  if (loading) return <Loading />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={tick}
          disabled={processing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-xs disabled:opacity-50"
        >
          {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Procesar siguiente
        </button>
        {items.some((m) => m.status === "failed") && (
          <button
            onClick={retryFailed}
            disabled={processing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs disabled:opacity-50"
            title='Re-encola los mensajes fallidos y re-habilita los leads descartados por "Número sin WhatsApp"'
          >
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Reintentar fallidos
          </button>
        )}
        {selected.size > 0 && (
          <button
            onClick={removeSelected}
            disabled={bulkDeleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs disabled:opacity-50"
          >
            {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Borrar {selected.size} seleccionado{selected.size === 1 ? "" : "s"}
          </button>
        )}
        <span className="text-xs text-slate-500">{items.length} mensajes en cola/historial</span>
      </div>
      {tickResult && (
        <div
          className={
            "text-xs px-3 py-2 rounded border " +
            (tickResult.kind === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : tickResult.kind === "warn"
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-rose-50 border-rose-200 text-rose-800")
          }
        >
          {tickResult.text}
        </div>
      )}
      {items.length === 0 ? (
        <Empty msg="Sin mensajes. Encola algo desde el detalle de un lead." />
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-brand-600"
                    title="Seleccionar todos los borrables"
                  />
                </th>
                <th className="text-left px-3 py-2.5">Teléfono</th>
                <th className="text-left px-3 py-2.5">Mensaje</th>
                <th className="text-left px-3 py-2.5">Programado</th>
                <th className="text-left px-3 py-2.5">Estado</th>
                <th className="text-left px-3 py-2.5">Intentos</th>
                <th className="text-right px-3 py-2.5 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((m) => {
                const rowDeletable = m.status !== "sending";
                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={!rowDeletable}
                        checked={selected.has(m.id)}
                        onChange={() => toggle(m.id)}
                        className="accent-brand-600 disabled:opacity-30"
                        title={rowDeletable ? "" : "En envío"}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{m.phoneNormalized}</td>
                    <td className="px-3 py-2 text-xs max-w-md truncate" title={m.renderedMessage}>{m.renderedMessage}</td>
                    <td className="px-3 py-2 text-xs">
                      {m.scheduledAt ? new Date(m.scheduledAt).toLocaleString("es-ES") : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{m.status}</td>
                    <td className="px-3 py-2 text-xs">{m.sendAttempts}{m.lastError && ` ⚠ ${m.lastError.slice(0, 40)}`}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {m.status === "queued" && (
                        <button
                          onClick={() => sendNow(m.id)}
                          disabled={sendingNowId === m.id}
                          className="mr-1 inline-flex items-center justify-center p-1.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-40"
                          title="Enviar ahora (ignora ventana y delay)"
                        >
                          {sendingNowId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      <button
                        onClick={() => removeOne(m.id)}
                        disabled={deletingId === m.id || !rowDeletable}
                        className="inline-flex items-center justify-center p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                        title={rowDeletable ? "Borrar de la cola" : "En envío, no se puede borrar"}
                      >
                        {deletingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ INBOX ============

function InboxList({
  loading,
  items,
  diagnostics
}: {
  loading: boolean;
  items: InboxRow[];
  diagnostics: { webhookLastHit: string | null; webhookLastEvent: string | null };
}) {
  if (loading) return <Loading />;
  if (items.length === 0) {
    const hit = diagnostics.webhookLastHit ? new Date(diagnostics.webhookLastHit) : null;
    const minSinceHit = hit ? Math.round((Date.now() - hit.getTime()) / 60_000) : null;
    return (
      <div className="bg-white rounded-xl border p-6 text-sm text-slate-600 space-y-3">
        <p className="font-medium text-slate-800">Sin mensajes recibidos todavía.</p>
        {hit ? (
          <div className="text-xs space-y-1 bg-emerald-50 border border-emerald-200 rounded-md p-2.5 text-emerald-800">
            <div>✅ WAHA SÍ está enviando eventos: último recibido hace {minSinceHit} min ({hit.toLocaleString("es-ES")}).</div>
            <div>Tipo del último evento: <code>{diagnostics.webhookLastEvent ?? "—"}</code>.</div>
            <div className="mt-1">
              Si llegan eventos pero no aparecen mensajes, lo más probable es que ese evento NO era de tipo
              "message" (puede ser un ack/typing/status). Pide al lead que escriba un mensaje de texto nuevo y vuelve.
            </div>
          </div>
        ) : (
          <div className="text-xs space-y-1 bg-rose-50 border border-rose-200 rounded-md p-2.5 text-rose-800">
            <div>❌ WAHA aún no ha enviado NINGÚN webhook a este Hub.</div>
            <div>
              Pulsa <strong>"Configurar webhook en WAHA"</strong> en Ajustes (arriba a la derecha) para que WAHA empiece a
              reenviarnos los mensajes entrantes. Si ya lo hiciste, comprueba que la sesión WAHA está
              en estado <code>WORKING</code> con "Probar conexión".
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((m) => (
        <li key={m.id} className={`bg-white rounded-lg border p-3 ${!m.read ? "border-brand-300" : ""}`}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-700">{m.fromPhone}</span>
              {m.lead && <span className="text-xs text-slate-500">· {m.lead.name}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              {m.classification && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                  {m.classification} {m.classificationConfidence != null && `(${Math.round(m.classificationConfidence * 100)}%)`}
                </span>
              )}
              <span className="text-[10px] text-slate-400">
                {new Date(m.receivedAt).toLocaleString("es-ES")}
              </span>
            </div>
          </div>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{m.body}</p>
        </li>
      ))}
    </ul>
  );
}

// ============ PLANTILLAS ============

function TemplatesTable({ loading, items, onChanged }: { loading: boolean; items: Template[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Template | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function remove(t: Template) {
    if (!confirm(`¿Borrar la plantilla "${t.name}"?`)) return;
    setDeletingId(t.id);
    try {
      const r = await fetch(`/api/v1/leads/templates/${t.id}`, { method: "DELETE" });
      if (r.ok) onChanged();
      else alert("No se pudo borrar la plantilla.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin plantillas. Crea la primera con 'Nueva plantilla'." />;
  return (
    <>
      <div className="grid md:grid-cols-2 gap-3">
        {items.map((t) => (
          <div key={t.id} className="bg-white rounded-lg border p-3">
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <h3 className="font-semibold text-sm truncate" title={t.name}>{t.name}</h3>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{t.channel}</span>
                {t.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">default</span>}
                <button onClick={() => setEditing(t)} className="p-1 text-slate-400 hover:text-brand-600" title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => remove(t)} disabled={deletingId === t.id} className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-40" title="Borrar">
                  {deletingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{t.body}</pre>
          </div>
        ))}
      </div>
      <TemplateModal
        open={!!editing}
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged(); }}
      />
    </>
  );
}

// ============ SECUENCIAS ============

function SequencesView() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/v1/leads/sequences")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Secuencias de seguimiento (drip): cada paso se envía tras un retraso. Se detienen solas si el lead responde.
        </p>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          Nueva secuencia
        </button>
      </div>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty msg="Sin secuencias todavía. Crea una con 'Nueva secuencia'." />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map((s) => (
            <div key={s.id} className="bg-white rounded-lg border p-3">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="font-semibold text-sm">{s.name}</h3>
                <div className="flex gap-1">
                  {s.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">activa</span>}
                  {s.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">default</span>}
                </div>
              </div>
              {s.description && <p className="text-xs text-slate-600 mb-1.5">{s.description}</p>}
              <ol className="space-y-1">
                {(s.steps ?? []).map((st: any, i: number) => (
                  <li key={st.id ?? i} className="text-xs text-slate-600 flex gap-2">
                    <span className="shrink-0 font-medium text-slate-500">
                      {i === 0 && (st.delayDays ?? 0) === 0 ? "Inmediato" : `+${st.delayDays ?? 0}d`}
                    </span>
                    <span className="truncate" title={st.templateBody}>{st.templateBody}</span>
                  </li>
                ))}
              </ol>
              {(s.steps?.length ?? 0) === 0 && <div className="text-xs text-slate-400">Sin pasos</div>}
            </div>
          ))}
        </div>
      )}

      <NewSequenceModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); load(); }} />
    </div>
  );
}

type StepDraft = { delayDays: number; templateBody: string; stopIfResponded: boolean };

/** Genera con IA una propuesta de pasos para la secuencia. El usuario indica
 *  keyword + tono y la IA devuelve N pasos con copy listo. */
function AiAutoFillBar({
  onFill
}: {
  onFill: (steps: Array<{ delayDays: number; templateBody: string }>) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState<"cercano" | "directo" | "consultor" | "comercial">("cercano");
  const [stepCount, setStepCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (!keyword.trim()) { setError("Indica un keyword/nicho."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/leads/sequences/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim(), tone, stepCount })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      onFill(j.steps ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Error de red");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-violet-900">✨ Auto-rellenar con IA</span>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs flex-1 min-w-[150px]">
          Keyword/nicho
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="peluquería, asesoría, restaurante…" className="w-full px-2 py-1.5 rounded border bg-white text-sm" />
        </label>
        <label className="text-xs">
          Tono
          <select value={tone} onChange={(e) => setTone(e.target.value as any)} className="px-2 py-1.5 rounded border bg-white text-sm">
            <option value="cercano">Cercano</option>
            <option value="directo">Directo</option>
            <option value="consultor">Consultor</option>
            <option value="comercial">Comercial</option>
          </select>
        </label>
        <label className="text-xs">
          Pasos
          <select value={stepCount} onChange={(e) => setStepCount(Number(e.target.value))} className="px-2 py-1.5 rounded border bg-white text-sm">
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Generar
        </button>
      </div>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      <p className="text-[11px] text-violet-700/70">Sustituirá los pasos actuales por la propuesta de la IA — puedes editarlos después.</p>
    </div>
  );
}

function NewSequenceModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [steps, setSteps] = useState<StepDraft[]>([{ delayDays: 0, templateBody: "", stopIfResponded: true }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setIsDefault(false);
    setSteps([{ delayDays: 0, templateBody: "", stopIfResponded: true }]);
    setError(null);
  }, [open]);

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }
  function addStep() {
    setSteps((prev) => [...prev, { delayDays: 1, templateBody: "", stopIfResponded: true }]);
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) { setError("Ponle un nombre a la secuencia."); return; }
    if (steps.length === 0) { setError("Añade al menos un paso."); return; }
    if (steps.some((st) => !st.templateBody.trim())) { setError("Cada paso necesita un mensaje."); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/leads/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          isDefault,
          steps: steps.map((st, idx) => ({
            order: idx,
            delayDays: st.delayDays,
            delayHours: st.delayDays * 24,
            templateBody: st.templateBody,
            channel: "whatsapp",
            stopIfResponded: st.stopIfResponded
          }))
        })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva secuencia de seguimiento"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear secuencia
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Seguimiento 3 toques" className="w-full px-3 py-2 rounded-lg border bg-white text-sm" />
          </label>
          <label className="text-xs">
            Descripción (opcional)
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para qué sirve" className="w-full px-3 py-2 rounded-lg border bg-white text-sm" />
          </label>
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-brand-600" />
          Aplicar por defecto a leads nuevos
        </label>

        <AiAutoFillBar
          onFill={(generated) =>
            setSteps(
              generated.map((st) => ({
                delayDays: st.delayDays,
                templateBody: st.templateBody,
                stopIfResponded: true
              }))
            )
          }
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Pasos</span>
            <button onClick={addStep} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
              <Plus className="h-3.5 w-3.5" /> Añadir paso
            </button>
          </div>
          {steps.map((st, i) => (
            <div key={i} className="border rounded-lg p-2.5 bg-slate-50 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Paso {i + 1}</span>
                <label className="text-xs flex items-center gap-1">
                  Tras
                  <input
                    type="number"
                    min={0}
                    value={st.delayDays}
                    onChange={(e) => updateStep(i, { delayDays: Math.max(0, Number(e.target.value)) })}
                    className="w-16 px-2 py-1 rounded border bg-white"
                  />
                  días {i === 0 && st.delayDays === 0 ? "(inmediato al enrolar)" : ""}
                </label>
                <label className="text-xs flex items-center gap-1 ml-auto cursor-pointer">
                  <input type="checkbox" checked={st.stopIfResponded} onChange={(e) => updateStep(i, { stopIfResponded: e.target.checked })} className="accent-brand-600" />
                  Parar si responde
                </label>
                {steps.length > 1 && (
                  <button onClick={() => removeStep(i)} className="text-slate-400 hover:text-rose-600" title="Eliminar paso">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <textarea
                value={st.templateBody}
                onChange={(e) => updateStep(i, { templateBody: e.target.value })}
                rows={2}
                placeholder="Mensaje. Placeholders: {{nombre}}, {{provincia}}…"
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
              />
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

// ============ EXCLUSIONES ============

function ExclusionsView() {
  const [exclusions, setExclusions] = useState<any[]>([]);
  const [optouts, setOptouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/v1/leads/exclusions")
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .catch(() => ({ items: [] })),
      fetch("/api/v1/leads/optouts")
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .catch(() => ({ items: [] }))
    ])
      .then(([e, o]) => {
        setExclusions((e as any).items ?? []);
        setOptouts((o as any).items ?? []);
      })
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-semibold mb-2">Exclusiones por nombre ({exclusions.length})</h3>
        {exclusions.length === 0 ? (
          <Empty msg="Sin exclusiones. Añade patrones de nombre para que no se contacte." />
        ) : (
          <ul className="space-y-1">
            {exclusions.map((e: any) => (
              <li key={e.id} className="bg-white rounded border px-3 py-2 text-sm">
                <span className="font-mono text-xs text-slate-500 mr-2">{e.matchMode}</span>
                {e.matchValue}
                {e.reason && <span className="text-xs text-slate-500 ml-2">— {e.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-sm font-semibold mb-2">Opt-outs ({optouts.length})</h3>
        {optouts.length === 0 ? (
          <Empty msg="Sin opt-outs. Se añaden automáticamente cuando el inbox clasifica un mensaje como 'opt_out'." />
        ) : (
          <ul className="space-y-1">
            {optouts.map((o: any) => (
              <li key={o.id} className="bg-white rounded border px-3 py-2 text-sm">
                <span className="font-mono text-xs text-slate-700 mr-2">{o.phone}</span>
                <span className="text-xs text-slate-500">{o.source}</span>
                {o.reason && <span className="text-xs text-slate-500 ml-2">— {o.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ============ ANALYTICS ============

function AnalyticsView({ data, loading }: { data: any; loading: boolean }) {
  if (loading || !data) return <Loading />;
  const f = data.funnel ?? {};
  return (
    <div className="space-y-5">
      {/* Funnel */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        {[
          ["Total", f.total],
          ["Con tel", f.withPhone],
          ["Con WA", f.withWa],
          ["Contactado", f.contacted],
          ["Respondió", f.responded],
          ["Cliente", f.client],
          ["Descartado", f.discarded]
        ].map(([label, v]) => (
          <div key={label as string} className="bg-white rounded-lg border p-3 text-center">
            <div className="text-2xl font-semibold text-brand-700">{v ?? 0}</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{label as string}</div>
          </div>
        ))}
      </div>
      {/* Urgencia */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Urgencia</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.urgency ?? {}).map(([k, v]) => (
            <div key={k} className={`px-2.5 py-1 rounded-md border text-xs ${URGENCY_COLORS[k] ?? ""}`}>
              {k} · <strong>{v as number}</strong>
            </div>
          ))}
        </div>
      </div>
      {/* Score buckets */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Distribución de score</h3>
        <div className="grid grid-cols-5 gap-2">
          {Object.entries(data.scores ?? {}).map(([k, v]) => (
            <div key={k} className="bg-white rounded-lg border p-3 text-center">
              <div className="text-lg font-semibold text-slate-800">{v as number}</div>
              <div className="text-[11px] text-slate-500">{k}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Timelines simples */}
      <div className="grid md:grid-cols-2 gap-4">
        <Timeline title="Mensajes enviados (30d)" data={data.messages ?? []} color="bg-brand-500" />
        <Timeline title="Respuestas recibidas (30d)" data={data.responses ?? []} color="bg-emerald-500" />
      </div>
      {/* Top provincias */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Top provincias</h3>
        <div className="bg-white rounded-lg border divide-y">
          {(data.provinces ?? []).map((p: any) => (
            <div key={p.province} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{p.province}</span>
              <span className="font-semibold">{p.count}</span>
            </div>
          ))}
          {(data.provinces ?? []).length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-500">Sin datos</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Timeline({ title, data, color }: { title: string; data: { date: string; count: number }[]; color: string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
      <div className="bg-white rounded-lg border p-3 flex items-end gap-0.5 h-32">
        {data.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.count}`}
            className={`flex-1 ${color} rounded-t`}
            style={{ height: `${Math.max(2, (d.count / max) * 100)}%`, opacity: d.count === 0 ? 0.2 : 0.7 }}
          />
        ))}
      </div>
    </div>
  );
}

// ============ MODALES ============

function Loading() { return <div className="flex items-center justify-center py-12 text-slate-500"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…</div>; }
function Empty({ msg }: { msg: string }) { return <div className="bg-white rounded-xl border p-8 text-center text-sm text-slate-500">{msg}</div>; }

type LeadSourceKey =
  | "places"
  | "borme"
  | "trustpilot"
  | "doctoralia"
  | "idealista"
  | "fotocasa"
  | "linkedin";

const LEAD_SOURCES: Array<{
  key: LeadSourceKey;
  label: string;
  status: "ready" | "stub";
  help: string;
}> = [
  { key: "places", label: "Google Places", status: "ready", help: "Negocios listados en Google Maps." },
  { key: "borme", label: "BORME (constituciones)", status: "ready", help: "Sociedades recién constituidas en España (día 1, sin web ni GMB)." },
  { key: "trustpilot", label: "Trustpilot (reseñas bajas)", status: "stub", help: "Próximamente — falta configurar scraper." },
  { key: "doctoralia", label: "Doctoralia", status: "stub", help: "Próximamente — falta configurar scraper." },
  { key: "idealista", label: "Idealista", status: "stub", help: "Próximamente — falta API key." },
  { key: "fotocasa", label: "Fotocasa", status: "stub", help: "Próximamente — falta scraper." },
  { key: "linkedin", label: "LinkedIn", status: "stub", help: "Próximamente — falta integración PhantomBuster/Apollo." }
];

function NewSearchModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [source, setSource] = useState<LeadSourceKey>("places");
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [scope, setScope] = useState<"custom" | "spain">("custom");
  const [province, setProvince] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [skipExisting, setSkipExisting] = useState(false);
  const [lowRatingOnly, setLowRatingOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceMeta = LEAD_SOURCES.find((s) => s.key === source) ?? LEAD_SOURCES[0];
  const municipios = province ? municipalitiesForProvince(province) : [];
  useEffect(() => {
    if (!open) return;
    setSource("places");
    setKeyword("");
    setLocation("");
    setScope("custom");
    setProvince("");
    setMunicipality("");
    setSkipExisting(false);
    setLowRatingOnly(false);
    setError(null);
    setSaving(false);
  }, [open]);
  async function save() {
    if (!keyword.trim()) { setError("Falta el keyword / nicho a buscar"); return; }
    // En "places" exigimos localidad. En "borme" la localidad es OPCIONAL
    // (si se rellena, filtra por provincia; si no, trae toda España).
    if (source === "places" && scope === "custom" && !location.trim()) {
      setError("Falta la provincia / localidad");
      return;
    }
    if (sourceMeta.status === "stub") {
      setError(sourceMeta.help);
      return;
    }
    setSaving(true);
    setError(null);
    const r = await fetch("/api/v1/leads/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        location,
        scope,
        // Si se elige un municipio concreto, se busca a fondo solo ahí. Si se
        // elige solo provincia (municipio vacío), el backend itera TODOS sus
        // municipios (modo máximo volumen) para multiplicar resultados.
        municipality:
          source === "places" && scope === "custom" && municipality ? municipality : undefined,
        skipExisting,
        source,
        sourceConfig:
          source === "places" && lowRatingOnly
            ? { lowRatingOnly: true, maxRating: 3.5, minReviewsCount: 5 }
            : undefined
      })
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    onSaved();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="Nueva búsqueda de leads" size="md" footer={
      <>
        <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Crear búsqueda
        </button>
      </>
    }>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Las búsquedas se procesan en batches por el cron. Tras crearla pulsa "Procesar batch" para arrancar.
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Fuente de leads</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as LeadSourceKey)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
          >
            {LEAD_SOURCES.map((src) => (
              <option key={src.key} value={src.key}>
                {src.status === "stub" ? `${src.label} (próximamente)` : src.label}
              </option>
            ))}
          </select>
          <p className={"text-[11px] mt-1 " + (sourceMeta.status === "stub" ? "text-amber-700" : "text-slate-500")}>
            {sourceMeta.help}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Tipo de negocio</label>
          <select
            value={ALL_BUSINESS_TYPES_SET.has(keyword) ? keyword : ""}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
          >
            <option value="">— Elige un tipo de negocio o escríbelo abajo —</option>
            {BUSINESS_TYPE_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={source === "borme" ? "Sector / palabra clave (filtra empresas del BORME)" : "…o escribe la palabra clave (ej: plomero, dentista, abogado)"}
            className="w-full mt-2 px-3 py-2 rounded-lg border bg-white text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            {source === "borme" ? "Días hacia atrás" : "Alcance"}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={"flex items-center gap-2 p-2 rounded border cursor-pointer " + (scope === "custom" ? "bg-brand-50 border-brand-300" : "bg-white")}>
              <input type="radio" checked={scope === "custom"} onChange={() => setScope("custom")} className="accent-brand-600" />
              <span className="text-xs">
                {source === "borme" ? "Hoy (último día publicado)" : "Una provincia / localidad"}
              </span>
            </label>
            <label className={"flex items-center gap-2 p-2 rounded border cursor-pointer " + (scope === "spain" ? "bg-brand-50 border-brand-300" : "bg-white")}>
              <input type="radio" checked={scope === "spain"} onChange={() => setScope("spain")} className="accent-brand-600" />
              <span className="text-xs">
                {source === "borme" ? "Última semana" : "Toda España (52 provincias)"}
              </span>
            </label>
          </div>
        </div>
        {source === "places" && scope === "custom" && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Provincia</label>
                <select
                  value={PROVINCE_NAMES.includes(location) ? location : ""}
                  onChange={(e) => {
                    const p = e.target.value;
                    setProvince(p);
                    setMunicipality("");
                    setLocation(p);
                  }}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
                >
                  <option value="">— Elige provincia —</option>
                  {PROVINCE_NAMES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Municipio</label>
                <select
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  disabled={!province || municipios.length === 0}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">Todos los municipios (máximo volumen)</option>
                  {municipios.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <input
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setProvince("");
                setMunicipality("");
              }}
              placeholder="…o escribe la provincia / localidad a mano (ej: Málaga)"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
            />
            {province && !municipality && (
              <p className="text-[11px] text-emerald-700">
                Se buscarán los <strong>{municipios.length} municipios</strong> de {province} (máximo volumen → muchos más leads).
              </p>
            )}
          </div>
        )}
        {source === "borme" && (
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Provincia (opcional, filtra registro mercantil)"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
          />
        )}
        <label className="flex items-start gap-2 p-2 rounded-md border bg-slate-50/60 cursor-pointer">
          <input
            type="checkbox"
            checked={skipExisting}
            onChange={(e) => setSkipExisting(e.target.checked)}
            className="mt-0.5 accent-brand-600"
          />
          <div className="flex-1">
            <span className="text-xs font-medium text-slate-800">Solo nuevos negocios</span>
            <p className="text-[11px] text-slate-500">
              Saltar leads que ya estén en otra búsqueda anterior (por <code>placeId</code> de Google).
              Útil al rebuscar el mismo keyword o keywords que se solapan
              ("peluquería" vs "salón de belleza").
            </p>
          </div>
        </label>
        {source === "places" && (
          <label className="flex items-start gap-2 p-2 rounded-md border border-rose-200 bg-rose-50/40 cursor-pointer">
            <input
              type="checkbox"
              checked={lowRatingOnly}
              onChange={(e) => setLowRatingOnly(e.target.checked)}
              className="mt-0.5 accent-rose-600"
            />
            <div className="flex-1">
              <span className="text-xs font-medium text-slate-800">🔥 Solo negocios con reseñas bajas (≤3,5★)</span>
              <p className="text-[11px] text-slate-500">
                Filtra resultados a negocios con rating ≤3,5 y al menos 5 reseñas. Son los
                <strong> leads más urgentes</strong>: tienen problema reputacional y reciben mejor
                tu pitch GMB / parallel listings.
              </p>
            </div>
          </label>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

function TemplateModal({ open, onClose, onSaved, template }: { open: boolean; onClose: () => void; onSaved: () => void; template?: Template | null }) {
  const isEdit = !!template;
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setBody(template?.body ?? "");
    setIsDefault(template?.isDefault ?? false);
    setError(null);
  }, [open, template]);
  async function save() {
    if (!name.trim() || !body.trim()) { setError("Faltan nombre y cuerpo"); return; }
    setSaving(true);
    const r = await fetch(
      isEdit ? `/api/v1/leads/templates/${template!.id}` : "/api/v1/leads/templates",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, body, channel: template?.channel ?? "whatsapp", isDefault })
      }
    );
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    onSaved();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Editar plantilla" : "Nueva plantilla"} size="md" footer={
      <>
        <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
      </>
    }>
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" className="w-full px-3 py-2 rounded-lg border bg-white text-sm" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Mensaje. Placeholders disponibles: {{nombre_negocio}}, {{provincia}}, {{rating}}, {{competidor_top}}, {{opener_ia}}, ..." className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-brand-600" />
          Marcar como default (entra en pool de rotación)
        </label>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

function LeadsSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<any>(null);
  const [googleKey, setGoogleKey] = useState("");
  const [wahaKey, setWahaKey] = useState("");
  const [evoKey, setEvoKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wahaTesting, setWahaTesting] = useState(false);
  const [wahaTest, setWahaTest] = useState<any>(null);
  const [testSendPhone, setTestSendPhone] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testSendResult, setTestSendResult] = useState<any>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [webhookSetting, setWebhookSetting] = useState(false);
  const [webhookSetupResult, setWebhookSetupResult] = useState<{ ok: boolean; url?: string; error?: string } | null>(null);
  const [qrNonce, setQrNonce] = useState(0);
  const [qrError, setQrError] = useState<string | null>(null);
  const pollRef = useRef<any>(null);
  useEffect(() => {
    if (!open) return;
    setGoogleKey(""); setWahaKey(""); setEvoKey(""); setError(null); setSavedAt(null);
    fetch("/api/v1/leads/settings").then((r) => r.ok ? r.json() : null).then(setS);
  }, [open]);
  useEffect(() => {
    if (!open) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setReconnecting(false);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [open]);
  if (!s) return <Modal open={open} onClose={onClose} title="Ajustes leads" size="lg"><Loading /></Modal>;
  async function save() {
    setSaving(true);
    setError(null);
    const body: any = {
      whatsappProvider: s.whatsappProvider,
      wahaUrl: s.wahaUrl,
      wahaSession: s.wahaSession,
      evolutionUrl: s.evolutionUrl,
      evolutionInstance: s.evolutionInstance,
      whatsappCountryCode: s.whatsappCountryCode,
      notifyInterestedPhone: s.notifyInterestedPhone ?? "",
      sendEnabled: s.sendEnabled,
      sendPaused: s.sendPaused,
      sendWindowStart: s.sendWindowStart,
      sendWindowEnd: s.sendWindowEnd,
      sendDelayMinSec: s.sendDelayMinSec,
      sendDelayMaxSec: s.sendDelayMaxSec,
      sendOnWeekends: s.sendOnWeekends,
      dailyLimit: s.dailyLimit,
      enableVariations: s.enableVariations,
      validateWaBeforeSend: s.validateWaBeforeSend,
      maxAttempts: s.maxAttempts
    };
    if (googleKey) body.googleApiKey = googleKey;
    if (wahaKey) body.wahaApiKey = wahaKey;
    if (evoKey) body.evolutionApiKey = evoKey;
    const r = await fetch("/api/v1/leads/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setSavedAt(new Date());
  }
  function setField(k: string, v: any) { setS({ ...s, [k]: v }); }
  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  async function testWaha() {
    setWahaTesting(true);
    setWahaTest(null);
    try {
      const r = await fetch("/api/v1/leads/waha-test");
      setWahaTest(await r.json());
    } catch (e: any) {
      setWahaTest({ ok: false, message: `No se pudo lanzar el test: ${e?.message ?? e}` });
    }
    setWahaTesting(false);
  }
  async function sendTestWa() {
    if (!testSendPhone.trim()) return;
    setTestSending(true);
    setTestSendResult(null);
    try {
      const r = await fetch("/api/v1/leads/waha-test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testSendPhone })
      });
      setTestSendResult(await r.json());
    } catch (e: any) {
      setTestSendResult({ ok: false, message: `No se pudo enviar: ${e?.message ?? e}` });
    }
    setTestSending(false);
  }
  async function setupWebhook() {
    setWebhookSetting(true);
    setWebhookSetupResult(null);
    try {
      const r = await fetch("/api/v1/leads/waha-webhook-setup", { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setWebhookSetupResult({ ok: false, error: j?.error?.message ?? j?.message ?? `Error ${r.status}` });
      } else {
        setWebhookSetupResult({ ok: true, url: j.url });
      }
    } catch (e: any) {
      setWebhookSetupResult({ ok: false, error: e?.message ?? "Error de red" });
    }
    setWebhookSetting(false);
  }
  async function reconnectWaha() {
    setReconnecting(true);
    setWahaTest(null);
    try {
      const r = await fetch("/api/v1/leads/waha-session/restart", { method: "POST" });
      const j = await r.json();
      if (!j.ok) { setWahaTest(j); setReconnecting(false); return; }
    } catch (e: any) {
      setWahaTest({ ok: false, message: `No se pudo reiniciar: ${e?.message ?? e}` });
      setReconnecting(false);
      return;
    }
    stopPoll();
    let ticks = 0;
    const tick = async () => {
      ticks++;
      setQrError(null);
      setQrNonce((n) => n + 1);
      try {
        const r = await fetch("/api/v1/leads/waha-test");
        const j = await r.json();
        setWahaTest(j);
        if (j.ok || ticks > 60) { stopPoll(); setReconnecting(false); }
      } catch { /* sigue sondeando */ }
    };
    await tick();
    pollRef.current = setInterval(tick, 3000);
  }
  return (
    <Modal open={open} onClose={onClose} title="Ajustes NV Leads Pro" size="lg" footer={
      <>
        <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cerrar</button>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
      </>
    }>
      <div className="space-y-5">
        <section>
          <h3 className="text-sm font-semibold mb-2">🌐 Google Places API</h3>
          <input type="password" value={googleKey} onChange={(e) => setGoogleKey(e.target.value)} placeholder={s.googleConfigured ? "•••• (configurada, deja vacío para no cambiar)" : "AIza..."} className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
          <p className="mt-1 text-[11px] text-slate-500">Se cifra con AES-256-GCM. Requiere Places API habilitada.</p>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2">📱 WhatsApp</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-600">Proveedor:</span>
              <div className="inline-flex rounded-lg border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setField("whatsappProvider", "waha")}
                  className={`px-3 py-1.5 ${(s.whatsappProvider ?? "waha") === "waha" ? "bg-brand-600 text-white" : "bg-white hover:bg-slate-50"}`}
                >
                  WAHA
                </button>
                <button
                  type="button"
                  onClick={() => setField("whatsappProvider", "evolution")}
                  className={`px-3 py-1.5 border-l ${s.whatsappProvider === "evolution" ? "bg-brand-600 text-white" : "bg-white hover:bg-slate-50"}`}
                >
                  Evolution API
                </button>
              </div>
            </div>
            {s.whatsappProvider === "evolution" ? (
              <>
                <p className="text-[11px] text-emerald-700">Evolution API envía notas de voz, imágenes y archivos (también gratis). Tras guardar, pulsa Probar conexión y Reconectar para escanear el QR.</p>
                <input value={s.evolutionUrl ?? ""} onChange={(e) => setField("evolutionUrl", e.target.value)} placeholder="https://evolution.tu-servidor.com" className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
                <input type="password" value={evoKey} onChange={(e) => setEvoKey(e.target.value)} placeholder={s.evolutionConfigured ? "•••• (configurada)" : "API key (apikey global de Evolution)"} className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={s.evolutionInstance ?? "default"} onChange={(e) => setField("evolutionInstance", e.target.value)} placeholder="Nombre instancia" className="px-3 py-2 rounded-lg border bg-white text-sm" />
                  <input value={s.whatsappCountryCode ?? "34"} onChange={(e) => setField("whatsappCountryCode", e.target.value)} placeholder="Código país (34)" className="px-3 py-2 rounded-lg border bg-white text-sm" />
                </div>
              </>
            ) : (
              <>
                <input value={s.wahaUrl ?? ""} onChange={(e) => setField("wahaUrl", e.target.value)} placeholder="https://waha.ejemplo.com" className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
                <input type="password" value={wahaKey} onChange={(e) => setWahaKey(e.target.value)} placeholder={s.wahaConfigured ? "•••• (configurada)" : "API key WAHA"} className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={s.wahaSession ?? "default"} onChange={(e) => setField("wahaSession", e.target.value)} placeholder="Nombre sesión" className="px-3 py-2 rounded-lg border bg-white text-sm" />
                  <input value={s.whatsappCountryCode ?? "34"} onChange={(e) => setField("whatsappCountryCode", e.target.value)} placeholder="Código país (34)" className="px-3 py-2 rounded-lg border bg-white text-sm" />
                </div>
                <p className="text-[11px] text-amber-700">WAHA Core no envía notas de voz (requiere WAHA Plus). Para voz gratis, cambia a Evolution API.</p>
              </>
            )}
            <div className="mt-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">📱 Avisar a este teléfono cuando un lead conteste interesado</label>
              <input
                value={s.notifyInterestedPhone ?? ""}
                onChange={(e) => setField("notifyInterestedPhone", e.target.value)}
                placeholder="Ej: +34 600 11 22 33"
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
              />
              <p className="text-[11px] text-slate-500 mt-1">Te llega un WhatsApp inmediato cuando la IA clasifica una respuesta como interesada. Déjalo vacío para no recibir avisos.</p>
            </div>
            <div className="text-[11px] text-slate-500 break-all">
              Webhook URL: <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/v1/leads/webhook/{s.webhookToken}</code>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={testWaha}
                disabled={wahaTesting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium disabled:opacity-50"
              >
                {wahaTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Probar conexión
              </button>
              <button
                type="button"
                onClick={setupWebhook}
                disabled={webhookSetting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-medium disabled:opacity-50"
                title="Configura el webhook de WAHA para que esta app reciba los mensajes entrantes en el Inbox"
              >
                {webhookSetting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Configurar webhook en WAHA
              </button>
              <span className="text-[11px] text-slate-400">Comprueba la sesión y, si los leads responden pero no aparecen en Inbox, pulsa "Configurar webhook".</span>
            </div>
            {webhookSetupResult && (
              <div className={`text-xs rounded-lg border p-2.5 ${webhookSetupResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                {webhookSetupResult.ok
                  ? `✓ Webhook configurado en WAHA (${webhookSetupResult.url}). A partir de ahora los mensajes entrantes llegarán al Inbox.`
                  : `✗ ${webhookSetupResult.error ?? "No se pudo configurar"}`}
              </div>
            )}
            {wahaTest && (
              <div className={`text-xs rounded-lg border p-2.5 ${wahaTest.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                <div className="font-medium">{wahaTest.ok ? "✓ Conectado" : "✗ No conectado"}</div>
                <div className="mt-0.5">{wahaTest.message}</div>
                {wahaTest.status && (
                  <div className="mt-1 text-[11px] opacity-80">
                    Estado: {wahaTest.status}{wahaTest.engine ? ` · Motor: ${wahaTest.engine}` : ""}{wahaTest.session ? ` · Sesión: ${wahaTest.session}` : ""}
                  </div>
                )}
              </div>
            )}
            {/* Envío de prueba: manda un WhatsApp real a un número tuyo para
                confirmar que la entrega funciona (y no solo el "200 OK"). */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
              <div className="text-[11px] font-medium text-slate-600">🧪 Enviar WhatsApp de prueba (a un número tuyo)</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="tel"
                  value={testSendPhone}
                  onChange={(e) => setTestSendPhone(e.target.value)}
                  placeholder="Ej: +34 600 11 22 33"
                  className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded-lg border text-xs"
                />
                <button
                  type="button"
                  onClick={sendTestWa}
                  disabled={testSending || !testSendPhone.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium disabled:opacity-50"
                >
                  {testSending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Enviar prueba
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Manda un mensaje real por la misma vía que las campañas. Si llega a tu teléfono, el envío funciona; si el panel dice OK pero no llega, la sesión no está entregando de verdad.
              </p>
              {testSendResult && (
                <div className={`text-xs rounded-lg border p-2.5 ${testSendResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                  <div className="font-medium">{testSendResult.ok ? "✓ Petición aceptada" : "✗ No enviado"}</div>
                  <div className="mt-0.5 break-all">{testSendResult.message}</div>
                  {testSendResult.ok && (
                    <div className="mt-1 text-[11px] opacity-80">
                      {testSendResult.messageId
                        ? `ID de mensaje: ${testSendResult.messageId} — abre ese chat en tu WhatsApp para confirmar la entrega.`
                        : "⚠️ WAHA respondió OK pero SIN ID de mensaje: la sesión NO está entregando (falso positivo)."}
                    </div>
                  )}
                </div>
              )}
            </div>
            {(reconnecting || (wahaTest && !wahaTest.ok && wahaTest.code !== "not_configured" && wahaTest.code !== "unreachable")) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={reconnectWaha}
                    disabled={reconnecting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium disabled:opacity-50"
                  >
                    {reconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {reconnecting ? "Reconectando…" : "Reconectar WhatsApp"}
                  </button>
                  <span className="text-[11px] text-amber-800">Reinicia la sesión desde cero. Si pide QR, escanéalo con el teléfono de Sonia.</span>
                </div>
                {reconnecting && wahaTest?.status && wahaTest.status !== "SCAN_QR_CODE" && (
                  <div className="text-[11px] text-amber-800">Esperando QR… (estado: {wahaTest.status})</div>
                )}
                {wahaTest?.status === "SCAN_QR_CODE" && (
                  <div className="flex flex-col items-center gap-1">
                    {!qrError && (
                      <img
                        src={`/api/v1/leads/waha-qr?n=${qrNonce}`}
                        alt="QR para vincular WhatsApp"
                        className="w-48 h-48 bg-white rounded-lg border"
                        onLoad={() => setQrError(null)}
                        onError={async () => {
                          // El QR no es una imagen: la ruta devolvió un JSON con el
                          // motivo (p.ej. Evolution count:0). Lo recuperamos y mostramos.
                          try {
                            const r = await fetch(`/api/v1/leads/waha-qr?n=${qrNonce}`);
                            const j = await r.json().catch(() => null);
                            setQrError(j?.message ?? "No se pudo obtener el QR.");
                          } catch {
                            setQrError("No se pudo obtener el QR.");
                          }
                        }}
                      />
                    )}
                    {qrError ? (
                      <span className="text-[11px] text-rose-700 max-w-[16rem] text-center">{qrError}</span>
                    ) : (
                      <span className="text-[11px] text-amber-800">WhatsApp → Dispositivos vinculados → Vincular dispositivo</span>
                    )}
                  </div>
                )}
                {wahaTest?.url && (
                  <div className="text-[11px] text-amber-700">
                    ¿No aparece el QR? Ábrelo en el panel de WAHA:{" "}
                    <a href={wahaTest.url} target="_blank" rel="noreferrer" className="underline break-all">{wahaTest.url}</a>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2">⏱ Ventana y rate limit</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label>Inicio ventana <input type="time" value={s.sendWindowStart ?? "09:00"} onChange={(e) => setField("sendWindowStart", e.target.value)} className="w-full px-2 py-1 rounded border" /></label>
            <label>Fin ventana <input type="time" value={s.sendWindowEnd ?? "20:00"} onChange={(e) => setField("sendWindowEnd", e.target.value)} className="w-full px-2 py-1 rounded border" /></label>
            <label>Delay min (s) <input type="number" value={s.sendDelayMinSec ?? 60} onChange={(e) => setField("sendDelayMinSec", Number(e.target.value))} className="w-full px-2 py-1 rounded border" /></label>
            <label>Delay max (s) <input type="number" value={s.sendDelayMaxSec ?? 180} onChange={(e) => setField("sendDelayMaxSec", Number(e.target.value))} className="w-full px-2 py-1 rounded border" /></label>
            <label>Daily limit <input type="number" value={s.dailyLimit ?? 80} onChange={(e) => setField("dailyLimit", Number(e.target.value))} className="w-full px-2 py-1 rounded border" /></label>
            <label>Max intentos <input type="number" value={s.maxAttempts ?? 3} onChange={(e) => setField("maxAttempts", Number(e.target.value))} className="w-full px-2 py-1 rounded border" /></label>
            <label title="Tope de mensajes enviados por hora. Anti-baneo: WhatsApp detecta ráfagas como bot.">
              Max/hora
              <input type="number" value={s.maxPerHour ?? 10} onChange={(e) => setField("maxPerHour", Number(e.target.value))} className="w-full px-2 py-1 rounded border" />
            </label>
            <label title="Mínimo de días entre dos mensajes al MISMO número. Evita doble contacto entre campañas.">
              Cool-down (días)
              <input type="number" value={s.minCoolDownDaysPerRecipient ?? 7} onChange={(e) => setField("minCoolDownDaysPerRecipient", Number(e.target.value))} className="w-full px-2 py-1 rounded border" />
            </label>
            <label title="Cap de NUEVAS conversaciones por día. Meta vigila este número más que el total.">
              Max nuevas convos/día
              <input type="number" value={s.maxNewChatsPerDay ?? 25} onChange={(e) => setField("maxNewChatsPerDay", Number(e.target.value))} className="w-full px-2 py-1 rounded border" />
            </label>
          </div>
          <div className={
            "mt-3 p-3 rounded-lg border " +
            (s.recoveryMode
              ? "bg-rose-50 border-rose-300 text-rose-900"
              : "bg-amber-50/40 border-amber-200 text-amber-900")
          }>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!s.recoveryMode}
                onChange={(e) => setField("recoveryMode", e.target.checked)}
                className="mt-0.5 accent-rose-600"
              />
              <div className="flex-1 text-xs">
                <strong className="block text-sm">🛡 Modo recuperación post-restricción WhatsApp</strong>
                <p className="mt-1">
                  Activa esto cuando Meta te haya restringido la cuenta. Aplica límites ultra-cautelosos
                  durante {s.recoveryDurationDays ?? 14} días: máx <strong>15/día</strong>, <strong>3/hora</strong>,
                  <strong> 8 nuevas convos/día</strong>, delay entre envíos <strong>5-15 min</strong>, cool-down
                  por número <strong>10 días</strong>. Después se auto-desactiva.
                </p>
                {s.recoveryMode && s.recoverySince && (
                  <p className="mt-1 font-mono text-[11px]">
                    Activo desde: {new Date(s.recoverySince).toLocaleString("es-ES")} ·
                    expira: {new Date(new Date(s.recoverySince).getTime() + (s.recoveryDurationDays ?? 14) * 86_400_000).toLocaleString("es-ES")}
                  </p>
                )}
              </div>
            </label>
          </div>
          <div className="flex flex-wrap gap-3 mt-2 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!!s.sendEnabled} onChange={(e) => setField("sendEnabled", e.target.checked)} className="accent-brand-600" />
              Envío activo
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!!s.sendPaused} onChange={(e) => setField("sendPaused", e.target.checked)} className="accent-brand-600" />
              Pausa global
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!!s.sendOnWeekends} onChange={(e) => setField("sendOnWeekends", e.target.checked)} className="accent-brand-600" />
              Enviar weekends
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!!s.enableVariations} onChange={(e) => setField("enableVariations", e.target.checked)} className="accent-brand-600" />
              Variaciones anti-spam
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={s.validateWaBeforeSend !== false} onChange={(e) => setField("validateWaBeforeSend", e.target.checked)} className="accent-brand-600" />
              Validar WhatsApp antes de enviar
            </label>
          </div>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2">🧹 Mantenimiento</h3>
          <CleanupOpenerButton />
        </section>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {savedAt && <p className="text-xs text-emerald-700">Guardado a las {savedAt.toLocaleTimeString("es-ES")}.</p>}
      </div>
    </Modal>
  );
}
