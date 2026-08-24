"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import OpportunityHunterPage from "@/app/admin/opportunity-hunter/page";
import Modal from "@/components/ui/Modal";
import { SectionBoundary } from "@/components/admin/SectionBoundary";
import { BUSINESS_TYPE_GROUPS, ALL_BUSINESS_TYPES } from "@/lib/leads/business-types";
import { PROVINCE_NAMES } from "@/lib/leads/spain-provinces";
import { municipalitiesForProvince } from "@/lib/leads/spain-municipalities";
import { localDayRangeUtc } from "@/lib/leads/local-day";
import { isSearchable, normalizeSearch, MIN_SEARCH_CHARS } from "@/lib/leads/inbox-conversations";
import { conversationHeader, conversationListTitle, displayedLeadPhone, managedChannelLabel } from "@/lib/leads/inbox-display";
import { usePollingChannel } from "@/lib/client/usePollingChannel";
import {
  ENQUEUE_BATCH_DELAY_MS,
  ENQUEUE_MAX_RATE_LIMIT_RETRIES,
  enqueueRetryDelayMs,
  splitEnqueueBatches
} from "@/lib/leads/enqueue-bulk";
import {
  ownerStateMeta,
  contactStateMeta,
  matchesLeadFilter,
  type OwnerView,
  type OwnerState,
  type OwnerResultFilter
} from "@/lib/leads/franchise-owner-view";

// Para saber si el keyword actual coincide con un tipo del desplegable (y
// reflejarlo seleccionado) sin recalcular el array en cada render.
const ALL_BUSINESS_TYPES_SET = new Set(ALL_BUSINESS_TYPES);

// Clasifica un teléfono español: móvil (6xx/7xx) → WhatsApp; fijo (8xx/9xx) →
// para llamar. El resto ("other"/"none") no se considera contactable.
type PhoneKind = "mobile" | "landline" | "other" | "none";
function phoneKind(phone: string | null | undefined): PhoneKind {
  if (!phone) return "none";
  let n = phone.replace(/[^\d]/g, "");
  if (n.startsWith("0034")) n = n.slice(4);
  else if (n.startsWith("34") && n.length > 9) n = n.slice(2);
  const d = n[0];
  if (d === "6" || d === "7") return "mobile";
  if (d === "8" || d === "9") return "landline";
  return "other";
}

// "Dolor ahora": negocio establecido (suficientes reseñas) con reputación baja
// → tiene un problema reputacional VIVO, encaje perfecto con el pitch GMB. Es
// más fuerte que un simple rating bajo de una ficha con 2 reseñas.
function isPainNow(l: { rating: number | null; reviewsCount: number }): boolean {
  return l.rating != null && l.rating <= 3.8 && (l.reviewsCount ?? 0) >= 10;
}
import {
  Loader2, Plus, Search, Inbox, ListChecks, BarChart3, MessageCircle,
  Settings as SettingsIcon, Ban, GitBranch, Send, RefreshCw, Download, Play, Pause, Trash2, Pencil, Zap, CalendarClock, Eye, Mail, Building2, Radar
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
  ticketScore: number | null;
  ticketTier: string | null;
  contactStatus: string;
  commercialTaskId: string | null;
  commercialSentAt: string | null;
  aiOpener: string | null;
  hasWhatsapp: boolean;
  // Origen solo-email (Franquicias): sin WhatsApp; se contacta por la cola de
  // revisión de email.
  emailOnly?: boolean;
  messagesSent: number;
  nextScheduledAt: string | null;
  // Vista compacta del TITULAR de franquicia serializada por la API de listado (o null si el lead
  // nunca se investigó). Alimenta la insignia por fila, el filtro y el panel de detalle.
  franchiseOwner?: OwnerView | null;
  franchiseOwnerState?: OwnerState;
};

// Forma reducida que devuelve la API en modo idsOnly (para "Seleccionar todos").
type MinimalLead = {
  id: string;
  phone: string | null;
  contactStatus: string;
  rating: number | null;
  reviewsCount: number;
  emailOnly?: boolean;
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
  leadsSkipped?: number;
  sourceConfig?: any;
  errorMessage?: string | null;
  monitored?: boolean;
  createdAt: string;
  _count?: { leads: number };
};

// Coste aprox. por consulta a Google Places Text Search (New) ≈ $0.032 ≈ €0.03.
// Solo para dar una idea de magnitud en búsquedas grandes (cuadrícula / país).
const EUR_POR_CONSULTA = 0.03;
// Total de municipios del dataset (para estimar "Toda España" + cuadrícula).
const SPAIN_MUNI_TOTAL = PROVINCE_NAMES.reduce((n, p) => n + municipalitiesForProvince(p).length, 0);

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
  kind?: string | null;
  instanceName?: string | null;
  warming?: boolean;
  willSend?: boolean;
  channelCap?: number;
};

type Tab = "leads" | "opportunities" | "searches" | "queue" | "jobs-review" | "franchises" | "trade-fairs" | "inbox" | "sequences" | "templates" | "exclusions" | "analytics" | "map" | "settings";

/** ¿Este mensaje de la cola se ENVIÓ hoy? (día natural local del navegador —
 *  España ≈ Madrid). Para resaltar en verde los envíos del día. */
function isSentTodayRow(m: QueueRow): boolean {
  if (!m.sentAt || !["sent", "delivered", "read"].includes(m.status)) return false;
  const d = new Date(m.sentAt);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// Tamaño de página de la tabla de leads. Una búsqueda "Toda España" puede
// devolver más de mil leads; se cargan de LEADS_PAGE en LEADS_PAGE con el
// botón "Cargar más" para no traerlos todos de golpe.
const LEADS_PAGE = 200;

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
  // Deep-link: abrir directamente una conversación de WhatsApp desde una tarea
  // creada en el generador de leads (/admin/leads?tab=inbox&phone=…).
  const [deepLinkPhone, setDeepLinkPhone] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab");
    const phone = sp.get("phone");
    if (t === "inbox") setTab("inbox");
    // La notificación "Email listo para revisar" enlaza a ?tab=jobs-review.
    if (t === "jobs-review") setTab("jobs-review");
    if (t === "opportunities") setTab("opportunities");
    if (t === "leads" && sp.get("search")) setSearchQ(sp.get("search")!);
    if (phone) setDeepLinkPhone(phone);
  }, []);
  const [recoveryInfo, setRecoveryInfo] = useState<{ active: boolean; since: string | null; days: number } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  // Total real de leads que cumplen el filtro en BD (la tabla carga por
  // páginas de LEADS_PAGE; el contador "X de Y" usa este total).
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  // Badge de la pestaña WhatsApp: nº de mensajes entrantes sin leer.
  const [inboxUnread, setInboxUnread] = useState(0);
  const loadInboxUnread = () =>
    fetch("/api/v1/leads/inbox/conversations?countOnly=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setInboxUnread(d.totalUnread ?? 0); })
      .catch(() => {});
  useEffect(() => {
    void loadInboxUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  usePollingChannel(loadInboxUnread, 30_000); // badge no-leídos: pausable al ocultar (F2.6)
  const [inboxDiag, setInboxDiag] = useState<{ webhookLastHit: string | null; webhookLastEvent: string | null; webhookLastDecision?: string | null; webhookLastFrom?: string | null; webhookLastBody?: string | null; webhookLastKeys?: string | null; webhookLastMsgAt?: string | null; webhookLastMsgDecision?: string | null; webhookLastMsgEvent?: string | null; webhookLastMsgFrom?: string | null; webhookLastMsgBody?: string | null; webhookLastMsgPayloadKeys?: string | null; webhookMe?: string | null; webhookSession?: string | null }>({ webhookLastHit: null, webhookLastEvent: null });
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState("ALL");
  const [searchIdFilter, setSearchIdFilter] = useState("ALL");
  const [phoneFilter, setPhoneFilter] = useState<"ALL" | "mobile" | "landline">("ALL");
  const [painOnly, setPainOnly] = useState(false);
  const [ticketSort, setTicketSort] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [enrichingOwners, setEnrichingOwners] = useState(false);
  const [ownerProgress, setOwnerProgress] = useState<{ queued: number; done: number; doneEmpty: number; error: number } | null>(null);
  const [enrichingContacts, setEnrichingContacts] = useState(false);
  const [contactProgress, setContactProgress] = useState<{ identified: number; contactable: number; queued: number; noContact: number; error: number } | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [newSearchOpen, setNewSearchOpen] = useState(false);
  const [newTemplateOpen, setNewTemplateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Parámetros de filtro de leads compartidos por la carga inicial y por
  // "Cargar más", para que ambas pidan exactamente el mismo subconjunto.
  function leadFilterParams() {
    const q = new URLSearchParams();
    if (statusFilter !== "ALL") q.set("contactStatus", statusFilter);
    if (urgencyFilter !== "ALL") q.set("urgency", urgencyFilter);
    if (searchIdFilter !== "ALL") q.set("searchId", searchIdFilter);
    if (searchQ) q.set("search", searchQ);
    if (ticketSort) q.set("sort", "ticket");
    return q;
  }

  // Extracción masiva de emails de las webs de los leads del filtro actual.
  async function bulkExtractEmails() {
    if (extracting) return;
    setExtracting(true);
    try {
      const body: any = { limit: 100 };
      if (searchIdFilter !== "ALL") body.searchId = searchIdFilter;
      const r = await fetch("/api/v1/leads/extract-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        alert(`Emails extraídos: ${d.found} de ${d.scanned} webs revisadas.${d.scanned >= 100 ? "\nVuelve a pulsar para seguir con el resto." : ""}`);
        load();
      } else {
        alert(`Error: ${d?.error?.message ?? r.status}`);
      }
    } finally {
      setExtracting(false);
    }
  }

  // Sondea el progreso de la cola de titulares hasta que no quede nada en cola (o se agota
  // el margen). Actualiza el contador visible en cola/hechos/errores. No bloquea la UI.
  async function pollOwnerProgress() {
    for (let i = 0; i < 60; i++) {
      const sr = await fetch(`/api/v1/leads/franchises/enrich-owners?searchId=${encodeURIComponent(searchIdFilter)}`);
      if (sr.ok) {
        const sd = await sr.json().catch(() => ({}));
        if (sd.progress) { setOwnerProgress(sd.progress); if ((sd.progress.queued ?? 0) === 0) { load(); return; } }
      }
      await new Promise((res) => setTimeout(res, 6000));
    }
    load();
  }
  async function bulkEnrichFranchiseOwners(mode?: "retryErrors" | "retryEmpty") {
    if (enrichingOwners || searchIdFilter === "ALL") return;
    setEnrichingOwners(true);
    try {
      // ENCOLA y devuelve rápido (el cron investiga en 2º plano → nunca 502 por timeout).
      const r = await fetch("/api/v1/leads/franchises/enrich-owners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchId: searchIdFilter, ...(mode === "retryErrors" ? { retryErrors: true } : {}), ...(mode === "retryEmpty" ? { retryEmpty: true } : {}) })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Error: ${d?.error?.message ?? r.status}`); return; }
      setOwnerProgress(d.progress ?? null);
      if (d.queued === 0 && !mode) { alert(d.note ?? "No había nada nuevo que encolar."); }
      void pollOwnerProgress();
      load();
    } finally { setEnrichingOwners(false); }
  }
  async function retryFailedFranchiseOwners() { await bulkEnrichFranchiseOwners("retryErrors"); }
  async function retryEmptyFranchiseOwners() { await bulkEnrichFranchiseOwners("retryEmpty"); }

  // FASE 2 (contacto): encola la búsqueda de email/móvil para los titulares identificados.
  async function pollContactProgress() {
    for (let i = 0; i < 60; i++) {
      const sr = await fetch(`/api/v1/leads/franchises/enrich-contacts?searchId=${encodeURIComponent(searchIdFilter)}`);
      if (sr.ok) {
        const sd = await sr.json().catch(() => ({}));
        if (sd.progress) { setContactProgress(sd.progress); if ((sd.progress.queued ?? 0) === 0) { load(); return; } }
      }
      await new Promise((res) => setTimeout(res, 6000));
    }
    load();
  }
  async function bulkFindFranchiseContacts(mode?: "retryErrors") {
    if (enrichingContacts || searchIdFilter === "ALL") return;
    setEnrichingContacts(true);
    try {
      const r = await fetch("/api/v1/leads/franchises/enrich-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchId: searchIdFilter, ...(mode === "retryErrors" ? { retryErrors: true } : {}) })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Error: ${d?.error?.message ?? r.status}`); return; }
      setContactProgress(d.progress ?? null);
      if (d.queued === 0 && !mode) { alert(d.note ?? "No hay titulares identificados que buscar."); }
      void pollContactProgress();
      load();
    } finally { setEnrichingContacts(false); }
  }
  async function retryFailedFranchiseContacts() { await bulkFindFranchiseContacts("retryErrors"); }

  // Al elegir una búsqueda concreta, carga el estado de titular + contacto (sin encolar nada) para
  // que los contadores y el botón «Buscar email/móvil» aparezcan aunque ya se identificara antes.
  useEffect(() => {
    if (searchIdFilter === "ALL") { setOwnerProgress(null); setContactProgress(null); return; }
    let cancel = false;
    (async () => {
      const [o, c] = await Promise.all([
        fetch(`/api/v1/leads/franchises/enrich-owners?searchId=${encodeURIComponent(searchIdFilter)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/v1/leads/franchises/enrich-contacts?searchId=${encodeURIComponent(searchIdFilter)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      if (cancel) return;
      if (o?.progress) setOwnerProgress(o.progress);
      if (c?.progress) setContactProgress(c.progress);
    })();
    return () => { cancel = true; };
  }, [searchIdFilter]);

  // Trae la siguiente página de leads y la añade a la tabla (sin recargar las
  // ya visibles). El offset es el nº de leads ya cargados desde el servidor.
  async function loadMoreLeads() {
    setLoadingMore(true);
    try {
      const q = leadFilterParams();
      q.set("limit", String(LEADS_PAGE));
      q.set("offset", String(leads.length));
      const r = await fetch(`/api/v1/leads?${q.toString()}`);
      if (r.ok) {
        const d = await r.json();
        setLeads((prev) => [...prev, ...(d.items ?? [])]);
        setLeadsTotal(d.total ?? leadsTotal);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  // Trae TODOS los leads del filtro actual (solo campos mínimos) para poder
  // seleccionarlos de un clic sin pasar página por página.
  async function fetchAllMatchingLeads(): Promise<MinimalLead[]> {
    const q = leadFilterParams();
    q.set("idsOnly", "1");
    const r = await fetch(`/api/v1/leads?${q.toString()}`);
    if (!r.ok) return [];
    return ((await r.json()).items ?? []) as MinimalLead[];
  }

  async function load() {
    setLoading(true);
    try {
      if (tab === "leads") {
        const q = leadFilterParams();
        q.set("limit", String(LEADS_PAGE));
        q.set("offset", "0");
        const [leadsRes, searchesRes] = await Promise.all([
          fetch(`/api/v1/leads?${q.toString()}`),
          fetch("/api/v1/leads/searches")
        ]);
        if (leadsRes.ok) {
          const d = await leadsRes.json();
          setLeads(d.items ?? []);
          setLeadsTotal(d.total ?? (d.items?.length ?? 0));
        }
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
  }, [tab, statusFilter, urgencyFilter, searchIdFilter, searchQ, ticketSort]);

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
      <DraggableTabs tab={tab} setTab={setTab} inboxUnread={inboxUnread} />

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
              value={phoneFilter}
              onChange={(e) => setPhoneFilter(e.target.value as "ALL" | "mobile" | "landline")}
              className="px-3 py-2 rounded-lg border bg-white text-sm"
              title="Filtrar por tipo de teléfono"
            >
              <option value="ALL">Móvil y fijo</option>
              <option value="mobile">📱 Solo móviles (WhatsApp)</option>
              <option value="landline">📞 Solo fijos (para llamar)</option>
            </select>
            <button
              type="button"
              onClick={() => setPainOnly((v) => !v)}
              title="Negocios con problema de reputación VIVO (rating ≤3,8 y ≥10 reseñas)"
              className={`px-3 py-2 rounded-lg border text-sm font-medium ${painOnly ? "bg-rose-600 text-white border-rose-600" : "bg-white hover:bg-slate-50"}`}
            >
              🔥 Dolor ahora
            </button>
            <button
              type="button"
              onClick={() => setTicketSort((v) => !v)}
              title="Ordenar por valor del cliente: sector premium, ya hace anuncios, precio €€€, tamaño"
              className={`px-3 py-2 rounded-lg border text-sm font-medium ${ticketSort ? "bg-violet-600 text-white border-violet-600" : "bg-white hover:bg-slate-50"}`}
            >
              💎 Ticket alto
            </button>
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
            <button
              type="button"
              onClick={bulkExtractEmails}
              disabled={extracting}
              title="Baja la web de cada lead y guarda su email de contacto (para listas de remarketing)"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm disabled:opacity-50"
            >
              {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : "✉️"}
              Extraer emails
            </button>
            {searchIdFilter !== "ALL" && (
              <>
                <button
                  type="button"
                  onClick={() => bulkEnrichFranchiseOwners()}
                  disabled={enrichingOwners}
                  title="Investiga la sociedad que explota cada local de esta búsqueda (por su dirección + la marca), administrador y contactos profesionales — nunca la central"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm disabled:opacity-50"
                >
                  {enrichingOwners ? <Loader2 className="h-4 w-4 animate-spin" /> : "🔎"}
                  Identificar franquiciados
                </button>
                {ownerProgress && (
                  <span className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-white text-xs text-slate-600" title="Estado de la identificación de titulares">
                    <span className="text-amber-600">⏳ {ownerProgress.queued} en cola</span>
                    <span className="text-emerald-600">✓ {ownerProgress.done} con datos</span>
                    {ownerProgress.doneEmpty > 0 && <span className="text-slate-500">∅ {ownerProgress.doneEmpty} sin datos</span>}
                    {ownerProgress.error > 0 && <span className="text-rose-600">⚠ {ownerProgress.error} errores</span>}
                  </span>
                )}
                {ownerProgress && ownerProgress.doneEmpty > 0 && (
                  <button
                    type="button"
                    onClick={retryEmptyFranchiseOwners}
                    disabled={enrichingOwners}
                    title="Reprocesa los locales que quedaron «hechos» pero sin datos (no confirmados / fallo antiguo)"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-sm disabled:opacity-50"
                  >
                    ↻ Reintentar sin resultado
                  </button>
                )}
                {ownerProgress && ownerProgress.error > 0 && (
                  <button
                    type="button"
                    onClick={retryFailedFranchiseOwners}
                    disabled={enrichingOwners}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm disabled:opacity-50"
                  >
                    ↻ Reintentar fallidos
                  </button>
                )}
                {/* FASE 2: buscar email/móvil profesional de los titulares ya identificados. */}
                {((ownerProgress?.done ?? 0) > 0 || (contactProgress?.identified ?? 0) > 0) && (
                  <>
                    <button
                      type="button"
                      onClick={() => bulkFindFranchiseContacts()}
                      disabled={enrichingContacts}
                      title="Busca email profesional verificado o móvil publicado del operador/administrador de cada titular identificado"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-sm disabled:opacity-50"
                    >
                      {enrichingContacts ? <Loader2 className="h-4 w-4 animate-spin" /> : "📧"}
                      Buscar email/móvil
                    </button>
                    {contactProgress && (
                      <span className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-white text-xs text-slate-600" title="Estado de la búsqueda de contacto profesional">
                        <span className="text-slate-600">👤 {contactProgress.identified} identificados</span>
                        <span className="text-emerald-600">📧 {contactProgress.contactable} contactables</span>
                        {contactProgress.queued > 0 && <span className="text-amber-600">⏳ {contactProgress.queued}</span>}
                        {contactProgress.noContact > 0 && <span className="text-slate-500">∅ {contactProgress.noContact} sin contacto</span>}
                        {contactProgress.error > 0 && <span className="text-rose-600">⚠ {contactProgress.error}</span>}
                      </span>
                    )}
                    {contactProgress && contactProgress.error > 0 && (
                      <button
                        type="button"
                        onClick={retryFailedFranchiseContacts}
                        disabled={enrichingContacts}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm disabled:opacity-50"
                      >
                        ↻ Reintentar contacto
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            <a
              href={`/api/v1/leads/email-list?source=all${searchIdFilter !== "ALL" ? `&searchId=${searchIdFilter}` : ""}`}
              title="Descarga la lista de emails (leads + clientes) para subir como Custom Audience a Meta"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-sm"
            >
              📥 Lista emails
            </a>
          </div>
          <LeadsTable
            loading={loading}
            items={leads.filter(
              (l) =>
                (phoneFilter === "ALL" || phoneKind(l.phone) === phoneFilter) &&
                (!painOnly || isPainNow(l))
            )}
            totalMatching={leadsTotal}
            loadedCount={leads.length}
            phoneFilter={phoneFilter}
            painOnly={painOnly}
            fetchAllMatching={fetchAllMatchingLeads}
            resetKey={`${statusFilter}|${urgencyFilter}|${searchIdFilter}|${searchQ}|${phoneFilter}|${painOnly}`}
            onChanged={load}
          />
          {!loading && leadsTotal > 0 && (
            <div className="flex items-center justify-center gap-3 py-3 text-sm text-slate-500">
              <span>
                Mostrando {leads.length} de {leadsTotal} lead{leadsTotal === 1 ? "" : "s"}
                {(phoneFilter !== "ALL" || painOnly) && " (antes de filtros de móvil/dolor)"}
              </span>
              {leads.length < leadsTotal && (
                <button
                  onClick={loadMoreLeads}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Cargar más
                </button>
              )}
            </div>
          )}
        </>
      )}

      {tab === "searches" && <SearchesTable loading={loading} items={searches} onChanged={load} />}
      {tab === "queue" && <QueueTable loading={loading} items={queue} onChanged={load} />}
      {tab === "jobs-review" && <JobsReviewPanel />}
      {tab === "opportunities" && <OpportunityHunterPage />}
      {tab === "franchises" && <FranchisesView />}
      {tab === "trade-fairs" && <TradeFairsView />}
      {tab === "inbox" && <InboxChat loading={loading} diagnostics={inboxDiag} initialPhone={deepLinkPhone} />}
      {tab === "sequences" && <SequencesView />}
      {tab === "templates" && <TemplatesTable loading={loading} items={templates} onChanged={load} />}
      {tab === "exclusions" && <ExclusionsView />}
      {tab === "analytics" && <AnalyticsView data={analytics} loading={loading} />}
      {tab === "map" && <LeadsMapView />}

      <NewSearchModal open={newSearchOpen} onClose={() => setNewSearchOpen(false)} onSaved={load} />
      <TemplateModal open={newTemplateOpen} template={null} onClose={() => setNewTemplateOpen(false)} onSaved={load} />
      <SectionBoundary label="Ajustes">
        <LeadsSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </SectionBoundary>
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

/** Pestaña Mapa: muestra los leads con coordenadas en un mapa Leaflet/OSM.
 *
 *  Filtro por BÚSQUEDA realizada (cerrajero, dentista…): se elige en un
 *  desplegable y el mapa carga del backend los leads de esa búsqueda
 *  (searchId), para ver por nicho qué zona ya se ha "atacado" (contactada) y
 *  cuál falta. Color del marker: verde = ya contactado, rojo = pendiente. */
function LeadsMapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [redrawing, setRedrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [niches, setNiches] = useState<{ keyword: string; leads: number }[]>([]);
  const [nicho, setNicho] = useState("");
  const [stats, setStats] = useState<{ total: number; atacados: number; pendientes: number; sinCoords: number }>({ total: 0, atacados: 0, pendientes: 0, sinCoords: 0 });

  // Pinta SOLO los leads ya atacados (contactados), en rojo.
  const draw = useCallback((items: any[]) => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (!layerRef.current) layerRef.current = L.layerGroup().addTo(map);
    const layer = layerRef.current;
    layer.clearLayers();

    const esAtacado = (l: any) =>
      (l.messagesSent ?? 0) > 0 || ["contacted", "replied", "qualified", "won", "lost", "in_sequence"].includes(l.contactStatus ?? "");
    const conCoords = items.filter((l) => l.latitude != null && l.longitude != null);
    const atacados = conCoords.filter(esAtacado);
    const pts: any[] = [];
    for (const l of atacados) {
      const color = "#ef4444"; // rojo = atacado
      const marker = L.circleMarker([l.latitude, l.longitude], {
        radius: 7, color, fillColor: color, fillOpacity: 0.75, weight: 1.5
      });
      marker.bindPopup(`
        <strong>${escapeHtmlClient(l.name)}</strong><br/>
        ${escapeHtmlClient(l.category ?? l.searchQuery ?? "")} ${l.province ? "· " + escapeHtmlClient(l.province) : ""}<br/>
        ${l.phone ?? "Sin teléfono"}<br/>
        <span style="color:${color};font-weight:600">✓ Ya atacado</span> ·
        Score ${l.score ?? "—"} · ${l.messagesSent ?? 0} msg
      `);
      layer.addLayer(marker);
      pts.push([l.latitude, l.longitude]);
    }
    setStats({ total: items.length, atacados: atacados.length, pendientes: conCoords.length - atacados.length, sinCoords: items.length - conCoords.length });
    if (pts.length > 0) {
      try { map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 }); } catch {}
    }
  }, []);

  // Carga del backend los leads (todos o de un NICHO/keyword) y los pinta.
  const loadLeads = useCallback(async (kw: string) => {
    setRedrawing(true);
    try {
      const url = kw ? `/api/v1/leads?keyword=${encodeURIComponent(kw)}&limit=500` : "/api/v1/leads?limit=500";
      const r = await fetch(url);
      const j = r.ok ? await r.json() : { items: [] };
      draw(j.items ?? []);
    } catch {
      /* deja el mapa como estaba */
    } finally {
      setRedrawing(false);
    }
  }, [draw]);

  useEffect(() => {
    let cancelled = false;

    async function loadLeaflet(): Promise<any> {
      const w = window as any;
      if (w.L) return w.L;
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
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
        const [leads, sres, L] = await Promise.all([
          fetch("/api/v1/leads?limit=500").then((r) => (r.ok ? r.json() : { items: [] })),
          fetch("/api/v1/leads/searches").then((r) => (r.ok ? r.json() : { items: [] })),
          loadLeaflet()
        ]);
        if (cancelled || !containerRef.current) return;
        LRef.current = L;
        // Agrupa las búsquedas por NICHO (keyword), uniendo localidades:
        // "cerrajero Málaga" + "cerrajero España" → un solo "cerrajero".
        const byKw = new Map<string, { keyword: string; leads: number }>();
        for (const s of (sres.items ?? [])) {
          const kw = String(s.keyword ?? "").trim();
          if (!kw) continue;
          const k = kw.toLowerCase();
          const cur = byKw.get(k) ?? { keyword: kw, leads: 0 };
          cur.leads += s._count?.leads ?? 0;
          byKw.set(k, cur);
        }
        const nrows = [...byKw.values()].filter((n) => n.leads > 0).sort((a, b) => b.leads - a.leads);
        setNiches(nrows);

        const items: any[] = leads.items ?? [];
        const geo = items.filter((l) => l.latitude != null && l.longitude != null);
        const center =
          geo.length > 0
            ? [geo.reduce((s, l) => s + l.latitude, 0) / geo.length, geo.reduce((s, l) => s + l.longitude, 0) / geo.length]
            : [40.4168, -3.7038];
        const map = L.map(containerRef.current).setView(center, geo.length > 0 ? 6 : 5);
        mapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
          maxZoom: 19
        }).addTo(map);
        draw(items);
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
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      layerRef.current = null;
    };
  }, [draw]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={nicho}
          onChange={(e) => { setNicho(e.target.value); void loadLeads(e.target.value); }}
          className="flex-1 min-w-[240px] px-3 py-2 rounded-lg border bg-white text-sm"
        >
          <option value="">— Todos los nichos —</option>
          {niches.map((n) => (
            <option key={n.keyword} value={n.keyword}>
              {n.keyword} ({n.leads})
            </option>
          ))}
        </select>
        {redrawing && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} /> Atacados <strong>{stats.atacados}</strong></span>
          <span className="text-slate-500">Pendientes {stats.pendientes}</span>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        Elige un nicho (p. ej. <strong>cerrajero</strong>) para ver en el mapa, en <span style={{ color: "#ef4444", fontWeight: 600 }}>rojo</span>, los negocios que <strong>ya se han atacado</strong> (contactados) — así ves qué zonas tienes cubiertas y dónde seguir.
        {stats.sinCoords > 0 && <> · {stats.sinCoords} sin coordenadas (no se pueden situar).</>}
        {niches.length === 0 && !loading && <> · No hay búsquedas con leads todavía.</>}
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
  { key: "opportunities", label: "Opportunity Hunter", icon: <Radar className="h-3.5 w-3.5" /> },
  { key: "searches",   label: "Búsquedas",   icon: <Search className="h-3.5 w-3.5" /> },
  { key: "queue",      label: "Cola envío",  icon: <Send className="h-3.5 w-3.5" /> },
  { key: "jobs-review", label: "📧 Empleos", icon: <Mail className="h-3.5 w-3.5" /> },
  { key: "franchises", label: "🏢 Franquicias", icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: "trade-fairs", label: "🎪 Expositores", icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: "inbox",      label: "Inbox",       icon: <Inbox className="h-3.5 w-3.5" /> },
  { key: "sequences",  label: "Secuencias",  icon: <GitBranch className="h-3.5 w-3.5" /> },
  { key: "templates",  label: "Plantillas",  icon: <ListChecks className="h-3.5 w-3.5" /> },
  { key: "exclusions", label: "Exclusiones", icon: <Ban className="h-3.5 w-3.5" /> },
  { key: "analytics",  label: "Analytics",   icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { key: "map",        label: "Mapa",        icon: <Search className="h-3.5 w-3.5" /> }
];
const LEADS_TAB_ORDER_KEY = "leads.tabOrder";

function DraggableTabs({ tab, setTab, inboxUnread = 0 }: { tab: Tab; setTab: (t: Tab) => void; inboxUnread?: number }) {
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
            {key === "inbox" ? (
              <button
                onClick={() => setTab(key)}
                className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100"
                }`}
                title="Inbox WhatsApp — todas las conversaciones de todos tus números"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
                {inboxUnread > 0 && (
                  <span className="ml-0.5 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[17px] h-[17px] px-1 inline-flex items-center justify-center">
                    {inboxUnread > 99 ? "99+" : inboxUnread}
                  </span>
                )}
              </button>
            ) : (
              <TabBtn icon={def.icon} label={def.label} active={active} onClick={() => setTab(key)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============ LEADS ============

// Clases de color por tono de estado del titular (insignia por fila).
const OWNER_TONE: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  slate: "bg-slate-100 text-slate-600 border-slate-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  none: "bg-white text-slate-400 border-slate-200"
};

/** Insignia por fila del estado del TITULAR de franquicia. "Con datos" resalta la evidencia real
 *  (operador/CIF); al pulsar abre la tarjeta de detalle con todos los campos y fuentes. */
function OwnerBadge({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const state = (lead.franchiseOwnerState ?? "none") as OwnerState;
  if (state === "none") return <span className="text-slate-300 text-xs">—</span>;
  const meta = ownerStateMeta(state);
  const o = lead.franchiseOwner;
  const tip =
    state === "done_data"
      ? [o?.operatorName, o?.taxId ? `CIF ${o.taxId}` : null, o?.confidence ? `confianza ${o.confidence}` : null].filter(Boolean).join(" · ")
      : state === "error"
        ? o?.lastError ?? "Error al investigar"
        : state === "done_empty"
          ? "Investigado sin evidencia útil — puedes reintentar sin resultado"
          : "En cola: se investiga en segundo plano";
  // Segundo chip: estado de CONTACTO (fase 2), solo cuando el titular está identificado.
  const cState = lead.franchiseOwner?.contactState ?? "none";
  const cMeta = state === "done_data" && cState !== "none" ? contactStateMeta(cState) : null;
  const channels = lead.franchiseOwner?.contactChannels ?? [];
  const cTip = cState === "actionable_contact"
    ? channels.map((c) => `${c.type === "email" ? "✉" : "📱"} ${c.value}`).join(" · ")
    : cState === "provider_error"
      ? lead.franchiseOwner?.contactLastError ?? "Error de proveedor"
      : cMeta?.label ?? "";
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        title={tip || meta.label}
        aria-label={`${meta.label}. Abrir detalle.`}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border hover:brightness-95 ${OWNER_TONE[meta.tone]}`}
      >
        {meta.short || meta.label}
      </button>
      {cMeta && cMeta.short && (
        <button
          type="button"
          onClick={onOpen}
          title={cTip || cMeta.label}
          aria-label={`${cMeta.label}. Abrir detalle.`}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border hover:brightness-95 ${OWNER_TONE[cMeta.tone]}`}
        >
          {cMeta.short}
        </button>
      )}
    </span>
  );
}

function LeadsTable({
  loading,
  items,
  totalMatching,
  loadedCount,
  phoneFilter,
  painOnly,
  fetchAllMatching,
  resetKey,
  onChanged
}: {
  loading: boolean;
  items: Lead[];
  totalMatching: number;
  loadedCount: number;
  phoneFilter: "ALL" | "mobile" | "landline";
  painOnly: boolean;
  fetchAllMatching: () => Promise<MinimalLead[]>;
  resetKey: string;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // true cuando la selección abarca TODOS los leads del filtro (todas las
  // páginas), no solo los visibles. Se apaga en cuanto el usuario toca algo.
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [enqueueOpen, setEnqueueOpen] = useState(false);
  const [enqueueKind, setEnqueueKind] = useState<"text" | "ranking">("text");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  // Filtro de TITULAR/CONTACTO de franquicia. El filtro comercialmente útil es «Contactables»
  // (canal accionable nuevo). Filtra las filas ya cargadas por el estado derivado en la API.
  const [ownerFilter, setOwnerFilter] = useState<OwnerResultFilter>("all");
  // ¿Alguna fila cargada tiene identificación de titular? Si no, ocultamos el filtro para no
  // ensuciar la barra en búsquedas normales sin franquicias.
  const anyOwner = items.some((l) => (l.franchiseOwnerState ?? "none") !== "none");
  const identifiedCount = items.filter((l) => (l.franchiseOwnerState ?? "none") === "done_data").length;
  const contactableCount = items.filter((l) => l.franchiseOwner?.contactState === "actionable_contact").length;
  const shownItems =
    ownerFilter === "all" ? items : items.filter((l) => matchesLeadFilter(l.franchiseOwner ?? null, ownerFilter));
  // CTA de Franquicias (origen solo-email): generar borradores en la cola.
  const [draftingEmails, setDraftingEmails] = useState(false);
  const [draftResult, setDraftResult] = useState<string | null>(null);
  const [commercialBusyId, setCommercialBusyId] = useState<string | null>(null);
  const [commercialResult, setCommercialResult] = useState<{ leadId: string; ok: boolean; text: string } | null>(null);

  async function sendToCommercial(lead: Lead) {
    if (lead.commercialSentAt) return;
    setCommercialBusyId(lead.id);
    setCommercialResult(null);
    try {
      const r = await fetch(`/api/v1/leads/${lead.id}/send-to-commercial`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        throw new Error(j?.error?.message ?? `Error ${r.status}`);
      }
      setCommercialResult({ leadId: lead.id, ok: true, text: "Tarea creada y WhatsApp enviado." });
      onChanged();
    } catch (error: any) {
      setCommercialResult({ leadId: lead.id, ok: false, text: error?.message ?? "No se pudo enviar a comercial." });
    } finally {
      setCommercialBusyId(null);
    }
  }

  // Al cambiar los filtros, limpia la selección (no al solo cargar más páginas).
  useEffect(() => {
    setSelected(new Set());
    setAllMatchingSelected(false);
  }, [resetKey]);

  // Contactable por WhatsApp = solo móviles (6xx/7xx) no excluidos/descartados
  // y de un origen que ADMITA WhatsApp (Franquicias no: solo email).
  // Acepta tanto el lead completo como la forma reducida de "Seleccionar todos".
  const canContact = (l: { phone: string | null; contactStatus: string; emailOnly?: boolean }) =>
    !l.emailOnly && phoneKind(l.phone) === "mobile" && !["excluded", "discarded"].includes(l.contactStatus);

  function clearSelection() {
    setSelected(new Set());
    setAllMatchingSelected(false);
  }

  // Selecciona de un clic TODOS los contactables del filtro (todas las páginas).
  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const rows = await fetchAllMatching();
      const ids = rows
        .filter(
          (r) =>
            (phoneFilter === "ALL" || phoneKind(r.phone) === phoneFilter) &&
            (!painOnly || isPainNow(r)) &&
            canContact(r)
        )
        .map((r) => r.id);
      setSelected(new Set(ids));
      setAllMatchingSelected(true);
    } finally {
      setSelectingAll(false);
    }
  }

  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin leads. Crea una búsqueda para captar." />;

  const contactable = items.filter(canContact);
  const allSelected = contactable.length > 0 && contactable.every((l) => selected.has(l.id));
  // Hay más leads en el filtro de los que están cargados en la tabla.
  const hasMoreMatching = loadedCount < totalMatching;

  function toggle(id: string) {
    setAllMatchingSelected(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setAllMatchingSelected(false);
    setSelected(allSelected ? new Set() : new Set(contactable.map((l) => l.id)));
  }

  const emailOnlyCount = items.filter((l) => l.emailOnly).length;

  async function generateFranchiseDrafts() {
    setDraftingEmails(true);
    setDraftResult(null);
    try {
      const r = await fetch("/api/v1/leads/franchises/draft-emails", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setDraftResult(j?.error?.message ?? "No se pudieron generar los borradores."); return; }
      setDraftResult(
        `✅ ${j.drafted ?? 0} borrador(es) creados · ${j.alreadyHandled ?? 0} ya tenían borrador/contacto · ${j.withoutEmail ?? 0} sin email. ` +
          `Revísalos y envíalos en 📧 Empleos → cola de revisión.`
      );
    } finally {
      setDraftingEmails(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* Origen solo-email (Franquicias): aquí no hay WhatsApp a propósito. */}
      {emailOnlyCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-900">
          <span>
            ✉️ {emailOnlyCount} lead(s) de <strong>Franquicias</strong> en esta vista: este origen se contacta por <strong>email</strong>, no por WhatsApp.
          </span>
          <button
            onClick={() => void generateFranchiseDrafts()}
            disabled={draftingEmails}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {draftingEmails ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "✉️"} Generar borradores de email
          </button>
          {draftResult && <span className="w-full text-xs text-emerald-800">{draftResult}</span>}
        </div>
      )}
      {/* Prompt estilo Gmail: cuando ya están marcados todos los contactables
          visibles y hay más en otras páginas, ofrece seleccionarlos todos. */}
      {!allMatchingSelected && allSelected && hasMoreMatching && (
        <div className="flex flex-wrap items-center justify-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-900">
          <span>Seleccionados los {selected.size} contactables de esta vista.</span>
          <button
            onClick={selectAllMatching}
            disabled={selectingAll}
            className="inline-flex items-center gap-1.5 font-semibold underline hover:no-underline disabled:opacity-50"
          >
            {selectingAll && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Seleccionar todos los contactables del filtro ({totalMatching})
          </button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
          <span className="text-sm text-brand-800 font-medium">
            {selected.size} lead(s) seleccionados{allMatchingSelected ? " · todo el filtro" : ""}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={clearSelection} className="text-xs text-slate-600 hover:underline">
              Quitar selección
            </button>
            <BulkStatusButton ids={Array.from(selected)} status="excluded" label="Excluir" onDone={() => { clearSelection(); onChanged(); }} />
            <BulkStatusButton ids={Array.from(selected)} status="discarded" label="Descartar" onDone={() => { clearSelection(); onChanged(); }} />
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
              onClick={() => { setEnqueueKind("ranking"); setEnqueueOpen(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
              title="Enviar la captura de Google (tú vs competencia) a los leads seleccionados"
            >
              📊 Imagen posicionamiento
            </button>
            <button
              onClick={() => { setEnqueueKind("text"); setEnqueueOpen(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Send className="h-4 w-4" />
              Encolar WhatsApp
            </button>
          </div>
        </div>
      )}
      {anyOwner && (
        <div className="flex items-center gap-2 text-xs text-slate-600 mb-2 flex-wrap" role="group" aria-label="Filtrar por titular/contacto de franquicia">
          <span className="font-medium">Franquicia:</span>
          {([
            ["all", "Todos"],
            ["contactable", `Contactables${contactableCount ? ` (${contactableCount})` : ""}`],
            ["with", `Titular identificado${identifiedCount ? ` (${identifiedCount})` : ""}`],
            ["without", "Sin resultado"]
          ] as [OwnerResultFilter, string][]).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setOwnerFilter(val)}
              aria-pressed={ownerFilter === val}
              className={`px-2.5 py-1 rounded-full border transition ${ownerFilter === val ? "bg-brand-600 text-white border-brand-600" : "bg-white hover:bg-slate-50 border-slate-200"}`}
            >
              {label}
            </button>
          ))}
          {ownerFilter !== "all" && (
            <span className="text-slate-400">· {shownItems.length} de {items.length}</span>
          )}
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
              <th className="text-left px-3 py-2.5">Comercial</th>
              {anyOwner && <th className="text-left px-3 py-2.5" title="Titular/franquiciado del establecimiento identificado">Titular</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shownItems.map((l) => {
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
                      title={rowContactable ? "" : l.emailOnly ? "Origen Franquicias: se contacta por email, no por WhatsApp" : "Sin teléfono o excluido/descartado"}
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
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {l.phone ? (
                      (() => {
                        const kind = phoneKind(l.phone);
                        return (
                          <span className="inline-flex items-center gap-1">
                            <a href={`tel:${l.phone.replace(/\s/g, "")}`} className="hover:underline">{l.phone}</a>
                            {kind === "mobile" && <span title="Móvil (WhatsApp)">📱</span>}
                            {kind === "landline" && (
                              <span className="text-[10px] px-1 rounded bg-amber-100 text-amber-700" title="Fijo: contactar por llamada">
                                Fijo
                              </span>
                            )}
                          </span>
                        );
                      })()
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{l.position ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {l.rating != null ? `★ ${l.rating}` : "—"} <span className="text-[10px] text-slate-500">({l.reviewsCount})</span>
                    {isPainNow(l) && <span className="ml-1" title="Dolor ahora: problema de reputación vivo">🔥</span>}
                  </td>
                  <td className="px-3 py-2 font-semibold">{l.score ?? "—"}</td>
                  <td className="px-3 py-2">
                    {l.urgency && (
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${urg}`}>{l.urgency}</span>
                    )}
                    {(l.ticketTier === "premium" || l.ticketTier === "alto") && (
                      <span
                        className={`ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] border ${l.ticketTier === "premium" ? "bg-violet-100 text-violet-700 border-violet-200" : "bg-indigo-50 text-indigo-700 border-indigo-200"}`}
                        title={`Ticket ${l.ticketTier} (valor ${l.ticketScore ?? "?"}/100)`}
                      >
                        💎 {l.ticketTier}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {l.emailOnly ? <span title="Origen Franquicias: contacto por email">✉️</span> : l.hasWhatsapp ? "✓" : "—"}
                  </td>
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
                  <td className="px-3 py-2 min-w-[175px]">
                    {l.commercialSentAt ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-semibold"
                          title={`Enviado a comercial el ${new Date(l.commercialSentAt).toLocaleString("es-ES")}`}
                        >
                          ✓ Enviado a comercial
                        </span>
                        {l.commercialTaskId && (
                          <a href={`/tareas?task=${l.commercialTaskId}`} className="text-[10px] text-brand-700 underline" title="Abrir tarea comercial">
                            Tarea ↗
                          </a>
                        )}
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => sendToCommercial(l)}
                          disabled={commercialBusyId === l.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-semibold disabled:opacity-50"
                          title="Crear tarea en AITOR (COMERCIAL) · LEADS GMB y avisar por WhatsApp"
                        >
                          {commercialBusyId === l.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListChecks className="h-3 w-3" />}
                          {l.commercialTaskId ? "Reintentar aviso" : "Crear tarea comercial"}
                        </button>
                        {commercialResult?.leadId === l.id && (
                          <div className={`text-[10px] max-w-[230px] ${commercialResult.ok ? "text-emerald-700" : "text-rose-600"}`}>
                            {commercialResult.text}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  {anyOwner && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <OwnerBadge lead={l} onOpen={() => setDetailLeadId(l.id)} />
                    </td>
                  )}
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
        initialKind={enqueueKind}
        onDone={() => {
          setEnqueueOpen(false);
          clearSelection();
          onChanged();
        }}
      />
      <EnrollModal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        leadIds={Array.from(selected)}
        onDone={() => {
          setEnrollOpen(false);
          clearSelection();
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
  const [converting, setConverting] = useState(false);
  const [convertMsg, setConvertMsg] = useState<{ ok: boolean; text: string; clientId?: string } | null>(null);
  useEffect(() => {
    setConvertMsg(null);
  }, [leadId]);

  const [enriching, setEnriching] = useState(false);
  const [reviewInfo, setReviewInfo] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setReviewInfo(null);
  }, [leadId]);

  async function enrichReviews() {
    if (!leadId) return;
    setEnriching(true);
    setReviewInfo(null);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/enrich-reviews`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setReviewInfo({ ok: false, text: j?.error?.message ?? `Error ${r.status}` });
      } else if (j.negative) {
        setReviewInfo({
          ok: true,
          text: `Reseña negativa de ${j.negative.rating}★${j.negative.author ? ` (${j.negative.author})` : ""}: "${j.negative.text.slice(0, 160)}". Usa {{resena_negativa}} en la plantilla.`
        });
      } else {
        setReviewInfo({ ok: true, text: `Reseñas guardadas (${j.reviewsCount}). No hay reseña negativa con texto para citar.` });
      }
    } catch (e: any) {
      setReviewInfo({ ok: false, text: e?.message ?? "Error de red" });
    }
    setEnriching(false);
  }

  const [sendingMockup, setSendingMockup] = useState(false);
  const [mockupMsg, setMockupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sendingRanking, setSendingRanking] = useState(false);
  const [harvesting, setHarvesting] = useState(false);
  const [rankingMsg, setRankingMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Pitch Bubui: mensaje de WhatsApp que vende Bubui a este negocio con una
  // demo personalizada (lead → captación product-led).
  const [pitching, setPitching] = useState(false);
  const [pitch, setPitch] = useState<{ message: string; demoUrl: string } | null>(null);
  const [pitchErr, setPitchErr] = useState<string | null>(null);
  // Kit directivo: contactar al máximo responsable por la vía profesional.
  const [dmLoading, setDmLoading] = useState(false);
  const [dmErr, setDmErr] = useState<string | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerResearch, setOwnerResearch] = useState<any | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactResult, setContactResult] = useState<any | null>(null);
  const [dm, setDm] = useState<{
    domain: string | null;
    directors: { role: string; name: string }[];
    emailGuesses: string[];
    found: { name: string; title: string | null; linkedin: string | null; email: string | null }[];
    verifiedEmails: { email: string; status: string; score: number | null }[];
    websiteEmails: string[];
    linkedinUrl: string;
    opener: string | null;
    disclaimer: string;
  } | null>(null);
  useEffect(() => {
    setMockupMsg(null);
    setPitch(null);
    setPitchErr(null);
    setDm(null);
    setDmErr(null);
    setExecEmail("");
    setExecStatus(null);
    setOwnerResearch(null);
    setContactResult(null);
  }, [leadId]);

  // FASE 2: busca email/móvil profesional publicado del titular (encola + sondea).
  async function findFranchiseContact() {
    if (!leadId) return;
    setContactLoading(true);
    setContactResult({ status: "queued", explanation: "En cola: buscando contacto profesional…" });
    try {
      const r = await fetch("/api/v1/leads/franchises/enrich-contacts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [leadId], force: true })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      if (d.queued === 0) { setContactResult({ status: "unconfirmed", explanation: d.note ?? "Requiere titular identificado primero." }); return; }
      for (let i = 0; i < 24; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const sr = await fetch(`/api/v1/leads/franchises/enrich-contacts?ids=${encodeURIComponent(leadId)}`);
        if (!sr.ok) continue;
        const sd = await sr.json().catch(() => ({}));
        const c = sd.items?.[0]?.contact;
        if (c && c.status && c.status !== "queued") { setContactResult(c); return; }
      }
      setContactResult({ status: "queued", explanation: "Aún buscando. Vuelve a abrir el lead en un minuto." });
    } catch (e: any) {
      setContactResult({ status: "provider_error", explanation: e?.message ?? "No se pudo buscar contacto" });
    } finally { setContactLoading(false); }
  }

  async function identifyFranchiseOwner() {
    if (!leadId) return;
    setOwnerLoading(true);
    setOwnerResearch({ status: "queued", classification: "unconfirmed", explanation: "En cola: investigando en segundo plano…" });
    try {
      // ENCOLA (devuelve rápido, sin 502) y luego SONDEA el estado hasta que el cron lo procese.
      const r = await fetch("/api/v1/leads/franchises/enrich-owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [leadId], force: true })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      // Sondeo cada 5s durante ~2 min. No bloquea la UI: se puede cerrar el modal.
      for (let i = 0; i < 24; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const sr = await fetch(`/api/v1/leads/franchises/enrich-owners?ids=${encodeURIComponent(leadId)}`);
        if (!sr.ok) continue;
        const sd = await sr.json().catch(() => ({}));
        const fo = sd.items?.[0]?.franchiseOwner;
        if (fo && (fo.status === "done" || fo.status === "error")) { setOwnerResearch(fo); return; }
      }
      setOwnerResearch({ status: "queued", classification: "unconfirmed", explanation: "Aún en cola. Vuelve a abrir el lead en un minuto para ver el resultado." });
    } catch (e: any) {
      setOwnerResearch({ classification: "unconfirmed", explanation: e?.message ?? "No se pudo investigar" });
    } finally { setOwnerLoading(false); }
  }

  const [execEmail, setExecEmail] = useState("");
  const [execStatus, setExecStatus] = useState<string | null>(null);
  const [execBusy, setExecBusy] = useState(false);

  async function loadDecisionMaker() {
    setDmLoading(true);
    setDmErr(null);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/decision-maker`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      setDm(d);
      // Pre-rellena con el mejor email disponible (web real > verificado > Apollo > patrón).
      const best = d.websiteEmails?.[0]
        || d.verifiedEmails?.find((v: any) => v.status === "valid")?.email
        || d.found?.find((p: any) => p.email)?.email
        || d.verifiedEmails?.[0]?.email
        || d.emailGuesses?.[0]
        || "";
      setExecEmail((cur) => cur || best);
    } catch (e: any) {
      setDmErr(e?.message ?? "No se pudo generar el kit");
    } finally {
      setDmLoading(false);
    }
  }

  async function startExecSequence() {
    setExecBusy(true);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/exec-outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: execEmail.trim() || undefined, directorName: dm?.directors?.[0]?.name || dm?.found?.[0]?.name })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      setExecStatus("active");
    } catch (e: any) {
      setExecStatus(`error: ${e?.message ?? "no se pudo iniciar"}`);
    } finally {
      setExecBusy(false);
    }
  }

  async function generateBubuiPitch() {
    setPitching(true);
    setPitchErr(null);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/bubui-pitch`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      setPitch({ message: d.message, demoUrl: d.demoUrl });
    } catch (e: any) {
      setPitchErr(e?.message ?? "No se pudo generar el pitch");
    } finally {
      setPitching(false);
    }
  }

  // Activación sin fricción: crea la ficha Bubui del lead y copia el enlace
  // mágico (bubui.app/negocios?claim=…) para enviárselo por WhatsApp.
  const [provisioning, setProvisioning] = useState(false);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [provErr, setProvErr] = useState<string | null>(null);
  async function provisionBubui() {
    setProvisioning(true);
    setProvErr(null);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/provision-bubui`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      setClaimUrl(d.claimUrl);
      try { await navigator.clipboard.writeText(d.claimUrl); } catch {}
    } catch (e: any) {
      setProvErr(e?.message ?? "No se pudo crear la ficha");
    } finally {
      setProvisioning(false);
    }
  }

  async function sendMockup() {
    if (!leadId) return;
    if (!confirm("¿Enviar el mockup de su ficha por WhatsApp a este lead?")) return;
    setSendingMockup(true);
    setMockupMsg(null);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/send-mockup`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setMockupMsg({ ok: false, text: j?.error?.message ?? `Error ${r.status}` });
      else setMockupMsg({ ok: true, text: "Mockup enviado por WhatsApp." });
    } catch (e: any) {
      setMockupMsg({ ok: false, text: e?.message ?? "Error de red" });
    }
    setSendingMockup(false);
  }

  async function sendRanking() {
    if (!leadId) return;
    if (!confirm("¿Enviar el informe de posicionamiento (tú vs competencia) por WhatsApp a este lead?")) return;
    setSendingRanking(true);
    setRankingMsg(null);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/send-ranking`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setRankingMsg({ ok: false, text: j?.error?.message ?? `Error ${r.status}` });
      else setRankingMsg({ ok: true, text: j.leadPosition ? `Informe enviado (posición #${j.leadPosition}).` : "Informe enviado." });
    } catch (e: any) {
      setRankingMsg({ ok: false, text: e?.message ?? "Error de red" });
    }
    setSendingRanking(false);
  }

  async function harvestCompetitors() {
    if (!leadId) return;
    if (!confirm("¿Cosechar los competidores de este lead como leads nuevos? (consulta Google y crea los que aún no tengas)")) return;
    setHarvesting(true);
    setRankingMsg(null);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/harvest-competitors`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setRankingMsg({ ok: false, text: j?.error?.message ?? `Error ${r.status}` });
      else setRankingMsg({ ok: true, text: j.message ?? `Cosechados ${j.created ?? 0} leads.` });
    } catch (e: any) {
      setRankingMsg({ ok: false, text: e?.message ?? "Error de red" });
    }
    setHarvesting(false);
  }

  async function convertToClient() {
    if (!leadId) return;
    setConverting(true);
    setConvertMsg(null);
    try {
      const r = await fetch(`/api/v1/leads/${leadId}/convert-to-client`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setConvertMsg({ ok: false, text: j?.error?.message ?? `Error ${r.status}` });
      } else {
        setConvertMsg({
          ok: true,
          text: j.created ? "Cliente creado en el Hub." : "Este lead ya era cliente.",
          clientId: j.clientId
        });
      }
    } catch (e: any) {
      setConvertMsg({ ok: false, text: e?.message ?? "Error de red" });
    }
    setConverting(false);
  }

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
          <div className="flex items-center gap-2 flex-wrap">
            {lead.convertedClientId ? (
              <a
                href="/clientes"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100"
              >
                ✓ Ya es cliente del Hub — ver clientes ↗
              </a>
            ) : (
              <button
                type="button"
                onClick={convertToClient}
                disabled={converting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
                title="Crea un cliente del Hub con los datos de este negocio y marca el lead como cliente"
              >
                {converting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                🤝 Convertir en cliente
              </button>
            )}
            {convertMsg && (
              <span className={`text-xs ${convertMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
                {convertMsg.ok ? "✓ " : "✗ "}
                {convertMsg.text}
                {convertMsg.ok && convertMsg.clientId && (
                  <a href="/clientes" className="ml-1 underline">Ver clientes ↗</a>
                )}
              </span>
            )}
            <button
              type="button"
              onClick={enrichReviews}
              disabled={enriching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium disabled:opacity-50"
              title="Baja las reseñas de Google y habilita citar una reseña negativa real en el mensaje ({{resena_negativa}})"
            >
              {enriching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              📝 Traer reseñas de Google
            </button>
            <a
              href={`/api/v1/leads/${leadId}/mockup`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium"
              title="Imagen antes/después de su ficha de Google para adjuntar en el mensaje"
            >
              🖼️ Ver mockup de su ficha
            </a>
            <button
              type="button"
              onClick={sendMockup}
              disabled={sendingMockup}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium disabled:opacity-50"
              title="Genera el mockup y lo envía como imagen por WhatsApp a este lead"
            >
              {sendingMockup && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              📤 Enviar mockup por WhatsApp
            </button>
            {mockupMsg && (
              <span className={`text-xs ${mockupMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
                {mockupMsg.ok ? "✓ " : "✗ "}
                {mockupMsg.text}
              </span>
            )}
            <a
              href={`/api/v1/leads/${leadId}/ranking`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium"
              title="Informe 'tú vs tu competencia' en Google para adjuntar en el mensaje"
            >
              📊 Ver posicionamiento vs competencia
            </a>
            <button
              type="button"
              onClick={sendRanking}
              disabled={sendingRanking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium disabled:opacity-50"
              title="Genera el informe de posicionamiento y lo envía como imagen por WhatsApp"
            >
              {sendingRanking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              📤 Enviar posicionamiento por WhatsApp
            </button>
            <button
              type="button"
              onClick={harvestCompetitors}
              disabled={harvesting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-xs font-medium disabled:opacity-50"
              title="Crea como leads nuevos los competidores de este negocio que aún no tengas"
            >
              {harvesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              🪃 Cosechar competidores como leads
            </button>
            {rankingMsg && (
              <span className={`text-xs ${rankingMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
                {rankingMsg.ok ? "✓ " : "✗ "}
                {rankingMsg.text}
              </span>
            )}
            <button
              type="button"
              onClick={generateBubuiPitch}
              disabled={pitching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100 text-xs font-medium disabled:opacity-50"
              title="Genera un WhatsApp que vende Bubui a este negocio con una demo personalizada"
            >
              {pitching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              🚀 Pitch Bubui
            </button>
            <button
              type="button"
              onClick={provisionBubui}
              disabled={provisioning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium disabled:opacity-50"
              title="Crea la ficha de Bubui de este negocio y copia el enlace de activación (sin fricción, sin contraseña)"
            >
              {provisioning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              ⚡ Crear Bubui + enlace
            </button>
            <button
              type="button"
              onClick={loadDecisionMaker}
              disabled={dmLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium disabled:opacity-50"
              title="Cómo llegar al directivo: cargos (BORME), correos corporativos probables, LinkedIn y primer mensaje ejecutivo"
            >
              {dmLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              🎯 Kit directivo
            </button>
            {(lead.address || (lead.rawData as any)?.source === "brand_locations") && (
              <button
                type="button"
                onClick={identifyFranchiseOwner}
                disabled={ownerLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium disabled:opacity-50"
                title="Investiga la sociedad que explota esta dirección y sus responsables profesionales"
              >
                {ownerLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                🔎 Identificar franquiciado
              </button>
            )}
            {((lead.rawData as any)?.franchiseOwner?.operatorName || ownerResearch?.operatorName) && (
              <button
                type="button"
                onClick={findFranchiseContact}
                disabled={contactLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium disabled:opacity-50"
                title="Busca email profesional verificado o móvil publicado del operador/administrador"
              >
                {contactLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                📧 Buscar email/móvil
              </button>
            )}
          </div>
          {((lead.rawData as any)?.franchiseOwner || ownerResearch) && (() => {
            const owner: any = ownerResearch ?? (lead.rawData as any).franchiseOwner;
            return (
              (() => {
                // Estado real: evidencia útil (operador/CIF/contactos/responsable) vs. "hecho sin datos".
                const hasEvidence = !!(owner.operatorName || owner.taxId || (owner.emails?.length ?? 0) > 0 || (owner.phones?.length ?? 0) > 0 || owner.ownerName);
                const status = owner.status ?? null;
                const isError = status === "error";
                const isQueued = status === "queued";
                const isEmpty = status === "done" && !hasEvidence;
                return (
              <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <strong className="text-blue-900">Titular del establecimiento</strong>
                  <span className="rounded-full border bg-white px-2 py-0.5">{owner.classification === "franchise" ? "Franquicia confirmada" : owner.classification === "corporate" ? "Tienda propia" : "Sin confirmar"}</span>
                  {hasEvidence && <span className="text-slate-500">Confianza: {owner.confidence ?? "baja"}</span>}
                  {isError && <span className="rounded-full border border-rose-200 bg-rose-50 text-rose-700 px-2 py-0.5">⚠ Error al investigar</span>}
                  {isQueued && <span className="rounded-full border border-amber-200 bg-amber-50 text-amber-700 px-2 py-0.5">⏳ En cola</span>}
                  {isEmpty && <span className="rounded-full border border-slate-200 bg-slate-100 text-slate-600 px-2 py-0.5">∅ Sin datos</span>}
                </div>
                {owner.operatorName && <div>Sociedad explotadora: <strong>{owner.operatorName}</strong>{owner.taxId ? ` · CIF ${owner.taxId}` : ""}</div>}
                {owner.ownerName && <div>Administrador/responsable: <strong>{owner.ownerName}</strong>{owner.ownerRole ? ` · ${owner.ownerRole}` : ""}</div>}
                {owner.operatorWebsite && <div>Web local: <a href={/^https?:/i.test(owner.operatorWebsite) ? owner.operatorWebsite : `https://${owner.operatorWebsite}`} target="_blank" rel="noreferrer" className="text-blue-700 underline">{owner.operatorWebsite}</a></div>}
                {owner.emails?.length > 0 && <div>Emails: {owner.emails.map((email: string) => <a key={email} href={`mailto:${email}`} className="ml-1 text-blue-700 underline">{email}</a>)}</div>}
                {owner.phones?.length > 0 && <div>Teléfonos locales: {owner.phones.join(" · ")}</div>}
                {owner.explanation && <div className="text-slate-600">{owner.explanation}</div>}
                {isEmpty && !owner.explanation && <div className="text-slate-500">Se investigó pero no se encontró evidencia útil del titular local. Puedes usar «Reintentar sin resultado».</div>}
                {isError && owner.lastError && <div className="text-rose-600">Motivo: {owner.lastError}</div>}
                {owner.sources?.length > 0 && <div>Fuentes: {owner.sources.map((s: any, i: number) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="ml-1 text-blue-700 underline">{s.title || `Fuente ${i + 1}`}</a>)}</div>}
              </div>
                );
              })()
            );
          })()}
          {((lead.rawData as any)?.franchiseOwner?.contact || contactResult) && (() => {
            const c: any = contactResult ?? (lead.rawData as any).franchiseOwner.contact;
            const channels: any[] = Array.isArray(c.channels) ? c.channels : [];
            const status = c.status ?? null;
            const toneCls =
              status === "actionable_contact" ? "border-emerald-200 bg-emerald-50/60" :
              status === "provider_error" ? "border-rose-200 bg-rose-50/60" : "border-slate-200 bg-slate-50";
            const badge =
              status === "actionable_contact" ? <span className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-emerald-700">📧 Contacto accionable</span> :
              status === "queued" ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">⏳ Buscando</span> :
              status === "provider_error" ? <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">⚠ Error de proveedor</span> :
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">Sin contacto nuevo</span>;
            return (
              <div className={`rounded-lg border p-3 text-xs space-y-1.5 ${toneCls}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <strong className="text-slate-800">Contacto profesional</strong>
                  {badge}
                </div>
                {channels.length > 0 && (
                  <ul className="space-y-1">
                    {channels.map((ch, i) => (
                      <li key={`${ch.type}:${ch.value}:${i}`} className="flex flex-wrap items-center gap-1.5">
                        <span>{ch.type === "email" ? "✉️" : "📱"}</span>
                        {ch.type === "email"
                          ? <a href={`mailto:${ch.value}`} className="text-emerald-700 underline font-medium">{ch.value}</a>
                          : <a href={`tel:${ch.value}`} className="text-emerald-700 underline font-medium">{ch.value}</a>}
                        {ch.person && <span className="text-slate-600">· {ch.person}{ch.role ? ` (${ch.role})` : ""}</span>}
                        <span className="text-slate-400">· {ch.source}</span>
                        {ch.confidence && <span className={`px-1 rounded text-[10px] ${ch.confidence === "high" ? "bg-emerald-100 text-emerald-700" : ch.confidence === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{ch.confidence}</span>}
                        {ch.verified?.status && <span className="px-1 rounded text-[10px] bg-blue-100 text-blue-700">{ch.verified.status}{ch.verified.score != null ? ` ${ch.verified.score}` : ""}</span>}
                        {ch.sourceUrl && <a href={ch.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">fuente</a>}
                      </li>
                    ))}
                  </ul>
                )}
                {c.explanation && <div className="text-slate-600">{c.explanation}</div>}
                {status === "provider_error" && c.lastError && <div className="text-rose-600">Motivo: {c.lastError}</div>}
                {status !== "actionable_contact" && status !== "queued" && (
                  <div className="text-slate-500">Solo se considera «contactable» un email verificado o un móvil publicado NUEVO (el fijo de Google no cuenta). Puedes reintentar la búsqueda.</div>
                )}
              </div>
            );
          })()}
          {dmErr && <div className="text-xs text-rose-600">✗ {dmErr}</div>}
          {dm && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2 text-xs">
              {dm.directors.length > 0 ? (
                <div>
                  <span className="font-semibold text-indigo-800">Directivos (BORME):</span>
                  <ul className="mt-0.5 space-y-0.5">
                    {dm.directors.map((d, i) => (
                      <li key={i} className="text-slate-700">• {d.role}: <strong>{d.name}</strong></li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-slate-500">Sin cargo nominal en BORME. Dirígete al máximo responsable.</div>
              )}
              {dm.websiteEmails.length > 0 && (
                <div>
                  <span className="font-semibold text-emerald-800">✉️ Emails de la web:</span>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {dm.websiteEmails.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => { void navigator.clipboard?.writeText(e); }}
                        className="px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-mono text-[11px]"
                        title="Copiar"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {dm.found.length > 0 && (
                <div>
                  <span className="font-semibold text-emerald-800">✅ Encontrados (Apollo):</span>
                  <ul className="mt-0.5 space-y-0.5">
                    {dm.found.map((p, i) => (
                      <li key={i} className="text-slate-700">
                        • <strong>{p.name}</strong>{p.title ? ` — ${p.title}` : ""}
                        {p.email && (
                          <button type="button" onClick={() => { void navigator.clipboard?.writeText(p.email ?? ""); }} className="ml-1 font-mono text-[11px] text-emerald-700 underline" title="Copiar email">{p.email}</button>
                        )}
                        {p.linkedin && <a href={p.linkedin} target="_blank" rel="noreferrer" className="ml-1 text-indigo-700 underline">in</a>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {dm.verifiedEmails.length > 0 && (
                <div>
                  <span className="font-semibold text-indigo-800">Emails verificados (Hunter):</span>
                  <ul className="mt-0.5 space-y-0.5">
                    {dm.verifiedEmails.map((v, i) => {
                      const ok = v.status === "valid" || v.status === "deliverable";
                      const risky = v.status === "accept_all" || v.status === "webmail" || v.status === "unknown";
                      return (
                        <li key={i} className="text-slate-700">
                          <button type="button" onClick={() => { void navigator.clipboard?.writeText(v.email); }} className="font-mono text-[11px] underline" title="Copiar">{v.email}</button>
                          <span className={`ml-1 px-1 rounded text-[10px] ${ok ? "bg-emerald-100 text-emerald-700" : risky ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                            {v.status}{v.score != null ? ` ${v.score}` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {dm.emailGuesses.length > 0 && (
                <div>
                  <span className="font-semibold text-indigo-800">Correos probables{dm.domain ? ` (@${dm.domain})` : ""}:</span>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {dm.emailGuesses.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => { void navigator.clipboard?.writeText(e); }}
                        className="px-1.5 py-0.5 rounded border bg-white hover:bg-slate-50 font-mono text-[11px]"
                        title="Copiar"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <a href={dm.linkedinUrl} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline font-medium">
                  🔗 Buscar a la persona en LinkedIn
                </a>
              </div>
              {dm.opener && (
                <div className="space-y-1">
                  <span className="font-semibold text-indigo-800">Primer mensaje (ejecutivo):</span>
                  <textarea readOnly value={dm.opener} rows={6} className="w-full rounded-md border bg-white p-2 font-mono leading-snug" />
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard?.writeText(dm.opener ?? ""); }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
                  >
                    📋 Copiar mensaje
                  </button>
                </div>
              )}
              <div className="border-t border-indigo-200 pt-2 space-y-1.5">
                <span className="font-semibold text-indigo-800">📨 Secuencia multicanal (email → LinkedIn → llamada → email)</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    value={execEmail}
                    onChange={(e) => setExecEmail(e.target.value)}
                    placeholder="email del directivo (para los pasos de email)"
                    className="flex-1 min-w-[180px] text-[11px] px-2 py-1 rounded border bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={startExecSequence}
                    disabled={execBusy || execStatus === "active"}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
                  >
                    {execBusy ? "…" : execStatus === "active" ? "✓ En marcha" : "Iniciar secuencia"}
                  </button>
                </div>
                {execStatus && execStatus !== "active" && <div className="text-[11px] text-rose-600">✗ {execStatus}</div>}
                {execStatus === "active" && (
                  <p className="text-[11px] text-emerald-700">Secuencia iniciada. Los emails se envían solos (con pie de baja); LinkedIn y llamada te llegan como recordatorio.</p>
                )}
              </div>
              <p className="text-[10px] text-slate-500 border-t border-indigo-200 pt-1">{dm.disclaimer}</p>
            </div>
          )}
          {provErr && <div className="text-xs text-rose-600">✗ {provErr}</div>}
          {claimUrl && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 space-y-2">
              <p className="text-[11px] text-emerald-800 font-medium">⚡ Ficha de Bubui creada. Enlace de activación (copiado):</p>
              <div className="flex items-center gap-2">
                <input readOnly value={claimUrl} className="flex-1 text-xs rounded-md border bg-white px-2 py-1.5 font-mono" />
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard?.writeText(claimUrl); }}
                  className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                >
                  Copiar
                </button>
              </div>
              <p className="text-[10px] text-emerald-700">Envíaselo por WhatsApp: al abrirlo entra sin contraseña y ve su ficha lista para activar. Caduca en 30 días.</p>
            </div>
          )}
          {pitchErr && <div className="text-xs text-rose-600">✗ {pitchErr}</div>}
          {pitch && (
            <div className="rounded-lg border border-pink-200 bg-pink-50/60 p-3 space-y-2">
              <textarea
                readOnly
                value={pitch.message}
                rows={7}
                className="w-full text-xs rounded-md border bg-white p-2 font-mono leading-snug"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard?.writeText(pitch.message); }}
                  className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-xs font-medium"
                >
                  📋 Copiar mensaje
                </button>
                <a
                  href={pitch.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium"
                >
                  👁️ Ver demo del negocio ↗
                </a>
                {lead?.phone && (
                  <a
                    href={`https://wa.me/${String(lead.phone).replace(/[^\d]/g, "")}?text=${encodeURIComponent(pitch.message)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium"
                  >
                    💬 Abrir en WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}
          {reviewInfo && (
            <div className={`text-xs px-3 py-2 rounded-md border ${reviewInfo.ok ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
              {reviewInfo.text}
            </div>
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
  onDone,
  initialKind
}: {
  open: boolean;
  onClose: () => void;
  leadIds: string[];
  onDone: () => void;
  initialKind?: "text" | "ranking" | "text_then_image" | "alternate";
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [kind, setKind] = useState<"text" | "ranking" | "text_then_image" | "voice" | "voice_image" | "alternate" | "mix">("text");
  // Reparto por % cuando kind === "mix" (anti-baneo + a medida).
  const [mix, setMix] = useState<Record<string, number>>({ voice_image: 25, ranking: 35, text_then_image: 20, text: 20, voice: 0 });
  const mixTotal = Object.values(mix).reduce((s, n) => s + (Number(n) || 0), 0);
  const usesImage = kind !== "text" && kind !== "voice";
  const [busy, setBusy] = useState(false);
  const [replaceQueued, setReplaceQueued] = useState(false);
  const [result, setResult] = useState<{ ok?: number; skipped?: { leadId: string; reason: string }[]; total: number; replacedQueued?: number; emailOnlySkipped?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Coste estimado de la imagen de posicionamiento: 1 consulta a Google Places
  // por lead (para calcular el ranking) ≈ €0.03 c/u.
  const rankCost = leadIds.length * EUR_POR_CONSULTA;
  const rankCostStr = rankCost >= 10 ? `${Math.round(rankCost)}€` : `${rankCost.toFixed(2)}€`;

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setKind(initialKind ?? "text");
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
    if (kind === "mix" && mixTotal !== 100) {
      setError(`Los porcentajes deben sumar 100% (ahora suman ${mixTotal}%).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: any = { leadIds, templateId: templateId || null, replaceQueued };
      if (kind === "mix") {
        payload.mix = Object.entries(mix)
          .filter(([, p]) => Number(p) > 0)
          .map(([k, p]) => ({ kind: k, percent: Number(p) }));
      } else {
        payload.kind = kind;
      }
      const batches = splitEnqueueBatches(leadIds, kind);
      let enqueued = 0;
      let replaced = 0;
      let emailOnlySkipped = 0;
      const skipped: { leadId: string; reason: string }[] = [];

      for (let index = 0; index < batches.length; index++) {
        if (index > 0) await new Promise((resolve) => setTimeout(resolve, ENQUEUE_BATCH_DELAY_MS));

        let r: Response;
        let rateLimitAttempt = 0;
        while (true) {
          r = await fetch("/api/v1/leads/queue/enqueue-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, leadIds: batches[index] })
          });
          if (r.status !== 429 || rateLimitAttempt >= ENQUEUE_MAX_RATE_LIMIT_RETRIES) break;
          const delayMs = enqueueRetryDelayMs(r.headers.get("Retry-After"), rateLimitAttempt);
          rateLimitAttempt++;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(
            `${j?.error?.message ?? `Error ${r.status}`} ` +
            `(lote ${index + 1}/${batches.length}; ${enqueued} ya encolados).`
          );
          return;
        }
        enqueued += j.ok ?? 0;
        replaced += j.replacedQueued ?? 0;
        emailOnlySkipped += j.emailOnlySkipped ?? 0;
        skipped.push(...(j.skipped ?? []));
      }
      setResult({ ok: enqueued, skipped, total: leadIds.length, replacedQueued: replaced, emailOnlySkipped });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Encolar WhatsApp a ${leadIds.length} lead(s)`}>
      {!result ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Se encolarán con el <strong>espaciado anti-baneo</strong> de Ajustes (ventana horaria, delay aleatorio entre envíos y tope diario).
          </p>
          {/* Tipo de mensaje */}
          <label className="block text-sm font-medium text-slate-700">Tipo de mensaje</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as any)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
          >
            <option value="text">💬 Solo texto</option>
            <option value="ranking">📊 Imagen + texto (pie de foto)</option>
            <option value="text_then_image">💬➜📊 Texto y luego imagen (2 mensajes)</option>
            <option value="voice">🎙️ Nota de voz IA</option>
            <option value="voice_image">🎙️+📊 Voz + imagen</option>
            <option value="alternate">🔀 Alternar imagen/texto (anti-baneo)</option>
            <option value="mix">🎚️ Mezcla por % (a tu medida)</option>
          </select>

          {kind === "mix" && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50/60 px-2.5 py-2 space-y-1.5">
              <div className="text-[12px] text-slate-700 font-medium">Reparto de formatos (deben sumar 100%)</div>
              {([
                ["voice_image", "🎙️+📊 Voz + imagen"],
                ["ranking", "📊 Imagen + texto"],
                ["text_then_image", "💬➜📊 Texto y luego imagen"],
                ["voice", "🎙️ Nota de voz"],
                ["text", "💬 Solo texto"]
              ] as const).map(([k, label]) => (
                <div key={k} className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 text-slate-700">{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={mix[k] ?? 0}
                    onChange={(e) => setMix((m) => ({ ...m, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                    className="w-16 px-2 py-1 rounded border bg-white text-right"
                  />
                  <span className="text-slate-400 w-14 text-right">≈ {Math.round(((mix[k] ?? 0) / 100) * leadIds.length)}</span>
                </div>
              ))}
              <div className={`text-[11px] font-medium ${mixTotal === 100 ? "text-emerald-700" : "text-rose-600"}`}>
                Suma: {mixTotal}% {mixTotal === 100 ? "✓" : "(debe ser 100%)"}
              </div>
            </div>
          )}

          {kind !== "text" && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-800">
              {kind === "ranking" && <>Envía <strong>imagen con tu texto como pie</strong> (un solo mensaje).</>}
              {kind === "text_then_image" && <>Envía <strong>2 mensajes</strong>: primero tu texto y, espaciado, la imagen.</>}
              {kind === "voice" && <>Envía una <strong>nota de voz IA</strong> con tu guion (requiere ElevenLabs en Ajustes; si no, cae a texto).</>}
              {kind === "voice_image" && <>Envía <strong>imagen + nota de voz</strong> (2 mensajes).</>}
              {kind === "alternate" && <>Reparte entre <strong>imagen+pie</strong> y <strong>texto+imagen</strong> para variar el patrón.</>}
              {kind === "mix" && <>Reparte los formatos según tus %, mezclados en el tiempo (mejor anti-baneo).</>}
              {usesImage && <> La imagen hace <strong>1 consulta a Places</strong> por lead.</>}
              {(kind === "voice" || kind === "voice_image" || kind === "mix") && <> La voz usa ElevenLabs (Ajustes).</>}
              {usesImage && (
                <div className="mt-0.5">
                  💶 Coste imagen estimado: <strong>~{rankCostStr}</strong> (máx. {leadIds.length} × ~{EUR_POR_CONSULTA.toFixed(2)}€).
                  Solo móviles; los fijos/sin WhatsApp se omiten.
                </div>
              )}
            </div>
          )}

          <label className="block text-sm font-medium text-slate-700">
            {kind === "ranking" ? "Texto que acompaña a la imagen (pie de foto)" : kind === "text" ? "Plantilla" : "Mensaje de texto"}
          </label>
          {templates.length === 0 ? (
            kind === "ranking" ? (
              <p className="text-xs text-slate-500">Sin plantilla: se enviará la imagen con un pie automático según la posición de cada lead.</p>
            ) : (
              <p className="text-sm text-amber-700">No hay plantillas todavía. Crea una en la pestaña <strong>Plantillas</strong>.</p>
            )
          ) : (
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
            >
              {kind === "ranking" && <option value="">— Pie automático —</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? " (por defecto)" : ""}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer pt-1 border-t">
            <input type="checkbox" checked={replaceQueued} onChange={(e) => setReplaceQueued(e.target.checked)} className="mt-0.5 accent-brand-600" />
            <span>
              <strong>Reemplazar lo que ya esté en cola</strong> de estos leads. Actívalo si ya los habías encolado (p. ej. como texto) y quieres cambiar el formato: borra sus mensajes <em>pendientes</em> y los reencola con este modo. No afecta a los ya enviados.
            </span>
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={busy || (kind !== "ranking" && kind !== "mix" && templates.length === 0)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {kind === "text" ? `Encolar ${leadIds.length}` : `Enviar a ${leadIds.length}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <strong className="text-emerald-700">{result.ok ?? 0}</strong> encolados de {result.total}.
            {(result.skipped?.length ?? 0) > 0 && <span className="text-amber-700"> {result.skipped!.length} omitidos.</span>}
            {(result.emailOnlySkipped ?? 0) > 0 && (
              <span className="text-amber-700"> (✉️ {result.emailOnlySkipped} de Franquicias: se contactan por email)</span>
            )}
          </p>
          {(result.skipped?.length ?? 0) > 0 && (
            <div className="max-h-40 overflow-y-auto text-xs bg-slate-50 border rounded p-2 space-y-0.5">
              {result.skipped!.slice(0, 50).map((s) => (
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

/** Etiqueta legible + color por estado de búsqueda (accesible: texto, no solo color). */
const SEARCH_STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pendiente", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  RUNNING: { label: "En curso", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  PAUSING: { label: "Pausando…", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  PAUSED: { label: "Pausada", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  CANCELLING: { label: "Cancelando…", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  CANCELLED: { label: "Cancelada", cls: "bg-slate-200 text-slate-700 border-slate-300" },
  COMPLETED: { label: "Completada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  FAILED: { label: "Error", cls: "bg-rose-50 text-rose-700 border-rose-200" }
};

function SearchesTable({ loading, items, onChanged }: { loading: boolean; items: SearchRow[]; onChanged: () => void }) {
  const [runningAllId, setRunningAllId] = useState<string | null>(null);
  const [controlBusyId, setControlBusyId] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin búsquedas. Pulsa 'Nueva búsqueda' arriba." />;
  async function process(id: string) {
    await fetch(`/api/v1/leads/searches/${id}/process`, { method: "POST" });
    onChanged();
  }
  /** Pausar/Reanudar/Cancelar una búsqueda. Confirma antes de cancelar. */
  async function control(id: string, action: "pause" | "resume" | "cancel") {
    if (action === "cancel" && !confirm("¿Cancelar esta búsqueda? Se detendrá el procesamiento; los leads ya guardados se conservan.")) return;
    setControlBusyId(id);
    try {
      const r = await fetch(`/api/v1/leads/searches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d?.error?.message ?? "No se pudo aplicar la acción.");
      }
    } finally {
      setControlBusyId(null);
      onChanged();
    }
  }
  async function toggleMonitor(id: string, monitored: boolean) {
    await fetch(`/api/v1/leads/searches/${id}/monitor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monitored })
    });
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
            const canProcess = s.status === "PENDING" || s.status === "RUNNING";
            const canPause = s.status === "PENDING" || s.status === "RUNNING";
            const canResume = s.status === "PAUSED" || s.status === "PAUSING";
            const canCancel = !["COMPLETED", "FAILED", "CANCELLED"].includes(s.status);
            const transitioning = s.status === "PAUSING" || s.status === "CANCELLING";
            const busy = controlBusyId === s.id || runningAllId === s.id;
            const pending = canProcess;
            const pct = s.totalProvinces > 0 ? Math.round((s.processedProvinces / s.totalProvinces) * 100) : 0;
            // Indicador de consultas y coste estimado (cada "target" ≈ 1 consulta;
            // ×3 si están activados los sinónimos). Útil en cuadrícula / Toda España.
            const variants = s.sourceConfig?.useSynonyms ? 3 : 1;
            const totalQueries = s.totalProvinces * variants;
            const doneQueries = s.processedProvinces * variants;
            const estCost = totalQueries * EUR_POR_CONSULTA;
            const costStr = estCost >= 10 ? `${Math.round(estCost)}€` : `${estCost.toFixed(2)}€`;
            const bigSearch = totalQueries > 20; // solo lo mostramos si tiene sentido
            return (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{s.keyword || <span className="text-slate-500 italic">marketing/IA (todos)</span>}</td>
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
                  {bigSearch && (
                    <div className="text-[10px] text-slate-400 mt-0.5" title="Consultas a Google Places (aprox.) y coste estimado">
                      🔎 {doneQueries.toLocaleString("es")}/{totalQueries.toLocaleString("es")} consultas · ~{costStr}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {/* Cifra REAL = leads únicos guardados (_count.leads). totalResults
                      es un contador de resultados procesados que infla cuando un
                      negocio aparece en varios municipios del troceado. */}
                  <div className="font-semibold" title="Negocios únicos guardados de esta campaña">
                    {(s._count?.leads ?? s.totalResults).toLocaleString("es")}
                  </div>
                  {s._count?.leads != null && s.totalResults > s._count.leads && (
                    <div className="text-[10px] text-slate-400" title="Resultados procesados (incluye el mismo negocio hallado en varios municipios/celdas). La cifra real de leads es la de arriba.">
                      {s.totalResults.toLocaleString("es")} procesados
                    </div>
                  )}
                  {(s.leadsSkipped ?? 0) > 0 && (
                    <div className="text-[10px] text-slate-400" title="Negocios encontrados que ya tenías (no se duplican)">
                      {(s.leadsSkipped ?? 0).toLocaleString("es")} ya existían
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={`inline-block px-1.5 py-0.5 rounded border ${(SEARCH_STATUS_META[s.status] ?? { cls: "" }).cls}`}>
                    {(SEARCH_STATUS_META[s.status] ?? { label: s.status }).label}
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
                  {canPause && (
                    <button
                      onClick={() => control(s.id, "pause")}
                      disabled={busy}
                      aria-label="Pausar búsqueda"
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded border bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-700 text-xs disabled:opacity-50"
                    >
                      <Pause className="h-3 w-3" /> Pausar
                    </button>
                  )}
                  {canResume && (
                    <button
                      onClick={() => control(s.id, "resume")}
                      disabled={busy}
                      aria-label="Reanudar búsqueda"
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded border bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700 text-xs disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" /> Reanudar
                    </button>
                  )}
                  {canCancel && (
                    <button
                      onClick={() => control(s.id, "cancel")}
                      disabled={busy}
                      aria-label="Cancelar búsqueda"
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 text-xs disabled:opacity-50"
                    >
                      <Ban className="h-3 w-3" /> {transitioning ? "…" : "Cancelar"}
                    </button>
                  )}
                  <button
                    onClick={() => toggleMonitor(s.id, !s.monitored)}
                    className={
                      "ml-1 inline-flex items-center gap-1 px-2 py-1 rounded border text-xs " +
                      (s.monitored
                        ? "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700"
                        : "bg-white hover:bg-slate-50")
                    }
                    title="Monitorización continua: detecta negocios nuevos y caídas de rating en esta búsqueda"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {s.monitored ? "Monitorizando" : "Monitorizar"}
                  </button>
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

/** Barra de estado EN VIVO de la cola: se autoactualiza y dice de un vistazo si
 *  se está enviando (🟢), en espera (🟡) o parado (🔴), con el motivo y los
 *  números clave. Así siempre sabes si sale tráfico sin pulsar Diagnóstico. */
function QueueLiveStatus() {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0); // fuerza recálculo del "hace X" cada minuto

  async function load() {
    try {
      const r = await fetch("/api/v1/leads/queue/diagnose");
      if (!r.ok) {
        setErr(true);
        return;
      }
      setErr(false);
      setD(await r.json());
    } catch {
      setErr(true);
    }
  }
  // Carga inicial (sin cambios). El refresco recurrente y el "tick" pasan a
  // canales pausables al ocultar la pestaña, sin solapamiento (F2.6).
  useEffect(() => {
    void load();
  }, []);
  usePollingChannel(() => void load(), 45_000);
  usePollingChannel(() => setTick((n) => n + 1), 60_000);

  if (err && !d) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Estado de la cola no disponible ahora mismo.
      </div>
    );
  }
  if (!d) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 inline-flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comprobando estado de la cola…
      </div>
    );
  }

  const health: string = d.health ?? "waiting";
  const theme =
    health === "ok"
      ? { box: "border-emerald-300 bg-emerald-50", pill: "bg-emerald-600 text-white", dot: "🟢", label: "Enviando" }
      : health === "stopped"
        ? { box: "border-rose-300 bg-rose-50", pill: "bg-rose-600 text-white", dot: "🔴", label: "Parado" }
        : health === "idle"
          ? { box: "border-slate-300 bg-slate-50", pill: "bg-slate-500 text-white", dot: "⚪", label: "Sin cola" }
          : { box: "border-amber-300 bg-amber-50", pill: "bg-amber-500 text-white", dot: "🟡", label: "En espera" };

  // "hace X" desde el último envío real (tick fuerza refresco cada minuto).
  const iso: string | null = d.counters?.lastSentAtISO ?? null;
  let ago = "—";
  if (iso) {
    void tick; // dependencia visual
    const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    ago = secs < 90 ? `hace ${secs}s` : secs < 5400 ? `hace ${Math.round(secs / 60)} min` : secs < 172800 ? `hace ${Math.round(secs / 3600)} h` : `hace ${Math.round(secs / 86400)} d`;
  }
  const connected = (d.sessions ?? []).filter((s: any) => s.connected === true).length;
  const totalSess = (d.sessions ?? []).length;

  // Hora del PRÓXIMO envío programado. Si ya hay vencidos (dueNow>0) el próximo
  // sale en el tick actual → "ahora". Si no, mostramos la hora exacta (y el día
  // si no es hoy) del mensaje encolado más cercano.
  const dueNow: number = d.queue?.dueNow ?? 0;
  const queued: number = d.queue?.queued ?? 0;
  const nextISO: string | null = d.queue?.nextScheduledAtISO ?? null;
  let nextSend = "—";
  if (queued === 0) {
    nextSend = "sin cola";
  } else if (dueNow > 0) {
    nextSend = "ahora";
  } else if (nextISO) {
    void tick; // refresca el "hoy/mañana" al pasar de día
    const dt = new Date(nextISO);
    const hhmm = dt.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
    const dayNext = dt.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
    const dayNow = new Date().toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
    nextSend = dayNext === dayNow ? hhmm : `${dt.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit" })} ${hhmm}`;
  }

  return (
    <div className={"rounded-lg border p-3 " + theme.box}>
      <div className="flex items-start gap-2 flex-wrap">
        <span className={"shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold " + theme.pill}>
          {theme.dot} {theme.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-800">{d.verdict}</div>
          {d.detail && <div className="text-[11px] text-slate-600 mt-0.5">{d.detail}</div>}
        </div>
        <button
          onClick={() => void load()}
          className="shrink-0 text-[11px] text-slate-500 hover:text-slate-800 border rounded px-2 py-0.5 bg-white/60"
          title="Actualizar ahora"
        >
          ↻ Actualizar
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          ["Enviados hoy", `${d.counters?.sentToday ?? 0} mensajes`],
          ["Programados para hoy", `${d.queue?.scheduledToday ?? 0} mensajes`],
          ["Límite máximo diario", `${d.settings?.dailyLimitEffective ?? "?"} mensajes`],
          ["Próximo envío", nextSend],
          ["Pendientes en cola", `${d.queue?.queued ?? 0} (${d.queue?.dueNow ?? 0} listos ahora)`],
          ["Números conectados", `${connected} / ${totalSess}`]
        ].map(([k, v], i) => (
          <div key={i} className="rounded border border-white/70 bg-white/70 px-2 py-1">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
            <div className="text-slate-800 font-medium text-sm">{v}</div>
          </div>
        ))}
      </div>
      {(d.sessions ?? []).some((s: any) => s.connected === false) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(d.sessions ?? [])
            .filter((s: any) => s.connected === false)
            .map((s: any, i: number) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 border border-rose-300 text-rose-700">
                🔴 {s.name} ({s.status})
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * Panel del módulo Empleos: toggle Automático / Revisar antes de enviar + cola
 * de emails redactados pendientes de aprobación (modo revisión). Cada email es
 * editable antes de aprobarlo. Solo se muestra expandido si hay algo que revisar.
 */
/**
 * Config de la BANDEJA DE ALERTAS de empleo (IMAP): en vez de scrapear, el
 * sistema lee un buzón donde llegan las alertas de LinkedIn/InfoJobs. Sin
 * créditos de scraping. Incluye botón para revisar el buzón al momento.
 */
function JobsInboxConfig({ onIngested }: { onIngested: () => void }) {
  const [cfg, setCfg] = useState<any | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [host, setHost] = useState("imap.gmail.com");
  const [port, setPort] = useState(993);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/v1/leads/settings");
      if (!r.ok) return;
      const j = await r.json();
      setCfg(j);
      setUser(j.jobsInboxUser ?? "");
      setHost(j.jobsInboxHost ?? "imap.gmail.com");
      setPort(j.jobsInboxPort ?? 993);
      setEnabled(!!j.jobsInboxEnabled);
    } catch {}
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body: any = { jobsInboxUser: user, jobsInboxHost: host, jobsInboxPort: Number(port) || 993, jobsInboxEnabled: enabled };
      if (pass.trim()) body.jobsInboxPassword = pass.trim();
      const r = await fetch("/api/v1/leads/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg({ kind: "err", text: j?.error?.message ?? "No se pudo guardar." }); return; }
      setPass("");
      setMsg({ kind: "ok", text: "Guardado." });
      void load();
    } finally { setSaving(false); }
  }

  async function testConn() {
    setTesting(true);
    setMsg(null);
    try {
      const body: any = { host, port: Number(port) || 993 };
      // Si hay credenciales en el formulario, probamos esas; si no, las guardadas.
      if (user.trim()) body.user = user.trim();
      if (pass.trim()) body.password = pass.trim();
      const r = await fetch("/api/v1/leads/jobs-inbox/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ kind: "err", text: j?.error?.message ?? "Error al probar la conexión." }); return; }
      if (!j.ok) { setMsg({ kind: "err", text: j.error ?? "No conecta." }); return; }
      setMsg({ kind: "ok", text: `✅ Conecta. ${j.unseen ?? 0} correo(s) sin leer · ${j.jobUnseen ?? 0} de portales de empleo pendientes de procesar.` });
    } finally { setTesting(false); }
  }

  async function ingestNow() {
    setIngesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/leads/jobs-inbox/ingest", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ kind: "err", text: j?.error?.message ?? "Error al revisar el buzón." }); return; }
      if (j.error) { setMsg({ kind: "err", text: j.error }); return; }
      setMsg({ kind: "ok", text: `Revisado: ${j.emails} email(s) de alerta · ${j.offers} oferta(s) · ${j.ingested} empresa(s) nueva(s).` });
      onIngested();
      void load();
    } finally { setIngesting(false); }
  }

  return (
    <details className="mt-2 rounded-md border border-slate-200 bg-white/70">
      <summary className="cursor-pointer select-none px-2.5 py-1.5 text-xs font-semibold text-slate-700">
        📥 Bandeja de alertas (sin scraping){(cfg?.jobsInboxConfigured || cfg?.jobsGoogleConnected) ? " · configurada" : " · sin configurar"}
      </summary>
      <div className="px-2.5 pb-2.5 space-y-2">
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs font-semibold text-indigo-900">Conexión segura con Google</div>
              <div className="text-[11px] text-indigo-700">
                {cfg?.jobsGoogleConnected ? `Conectado: ${cfg.jobsGoogleEmail}` : "Conecta el buzón sin guardar contraseñas IMAP."}
              </div>
            </div>
            <a href="/api/integrations/google-drive/connect?purpose=jobs_inbox" className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700">
              {cfg?.jobsGoogleConnected ? "Reconectar Google" : "Conectar con Google"}
            </a>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Conecta el Gmail donde llegan las <strong>alertas de empleo</strong> de LinkedIn/InfoJobs. El sistema leerá esas alertas y creará los leads
          <strong> sin gastar créditos de scraping</strong>. La configuración IMAP inferior queda disponible solo como alternativa.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Correo del buzón (usuario IMAP)" className="col-span-2 px-2 py-1 rounded border border-slate-300 text-sm" />
          <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder={cfg?.jobsInboxConfigured ? "Contraseña de aplicación (•••• guardada)" : "Contraseña de aplicación"} className="col-span-2 px-2 py-1 rounded border border-slate-300 text-sm" />
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host IMAP" className="px-2 py-1 rounded border border-slate-300 text-sm" />
          <input value={port} onChange={(e) => setPort(Number(e.target.value) || 993)} type="number" placeholder="Puerto" className="px-2 py-1 rounded border border-slate-300 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-indigo-600" />
          Revisar el buzón automáticamente cada ~30 min
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
          </button>
          <button onClick={() => void testConn()} disabled={testing} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50" title="Verifica que el buzón conecta (separa un fallo de credenciales de uno de extracción)">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "🔌"} Probar conexión
          </button>
          <button onClick={() => void ingestNow()} disabled={ingesting || (!cfg?.jobsInboxConfigured && !cfg?.jobsGoogleConnected)} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50" title={(cfg?.jobsInboxConfigured || cfg?.jobsGoogleConnected) ? "Lee ahora las alertas nuevas del buzón" : "Conecta primero el buzón con Google"}>
            {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "📥"} Revisar alertas ahora
          </button>
          {cfg?.jobsInboxLastRun && <span className="text-[11px] text-slate-400">Última: {new Date(cfg.jobsInboxLastRun).toLocaleString("es-ES")}</span>}
        </div>
        {msg && <div className={"text-[11px] " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")}>{msg.text}</div>}
      </div>
    </details>
  );
}

/**
 * Módulo Franquicias: nicho → IA propone marcas (verificadas) → eliges → se
 * analiza la salud de red de cada una (Google Maps) → informe + email a la
 * central en la cola de revisión. Enfocado a la CENTRAL (gestión de todas las
 * fichas con GMB HUB), no al franquiciado suelto.
 */
/** Config de las keys de Apollo/Hunter (para localizar al responsable de marketing). */
function DecisionMakerKeys() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [hunter, setHunter] = useState("");
  const [apollo, setApollo] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function load() {
    try { const r = await fetch("/api/v1/leads/settings"); if (r.ok) setCfg(await r.json()); } catch {}
  }
  useEffect(() => { void load(); }, []);
  async function save() {
    setSaving(true); setMsg(null);
    try {
      const body: any = {};
      if (hunter.trim()) body.hunterApiKey = hunter.trim();
      if (apollo.trim()) body.apolloApiKey = apollo.trim();
      const r = await fetch("/api/v1/leads/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j?.error?.message ?? "No se pudo guardar."); return; }
      setHunter(""); setApollo(""); setMsg("Guardado."); void load();
    } finally { setSaving(false); }
  }
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-700">
        ⚙️ Contacto del decisor — Apollo / Hunter
        {cfg && <span className="ml-2 text-[11px] font-normal text-slate-500">{cfg.apolloConfigured ? "Apollo ✓" : "Apollo ✗"} · {cfg.hunterConfigured ? "Hunter ✓" : "Hunter ✗"}</span>}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-[11px] text-slate-500">
          Para llegar al <strong>responsable de marketing</strong> de la central (no a <code>info@</code>) hace falta un proveedor de contactos B2B.
          <strong> Hunter</strong> da el email real por dominio+departamento; <strong>Apollo</strong> da nombre, cargo y LinkedIn. Con al menos uno ya funciona.
          Tienen límites/coste de créditos. Sin ninguno, se usa el email genérico de la web.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={hunter} onChange={(e) => setHunter(e.target.value)} type="password" placeholder={cfg?.hunterConfigured ? "Hunter API key (•••• guardada)" : "Hunter API key"} className="px-2 py-1 rounded border border-slate-300 text-sm" />
          <input value={apollo} onChange={(e) => setApollo(e.target.value)} type="password" placeholder={cfg?.apolloConfigured ? "Apollo API key (•••• guardada)" : "Apollo API key"} className="px-2 py-1 rounded border border-slate-300 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
          </button>
          {msg && <span className="text-[11px] text-emerald-700">{msg}</span>}
        </div>
      </div>
    </details>
  );
}

function TradeFairsView() {
  const [form, setForm] = useState({ name: "", url: "", venue: "", startsAt: "", endsAt: "", maxExhibitors: 100, autoQueue: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [fairQuery, setFairQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [foundFairs, setFoundFairs] = useState<any[]>([]);
  const [finderInfo, setFinderInfo] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/leads/trade-fairs", { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (response.ok) setHistory(json.items ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run() {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/v1/leads/trade-fairs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error?.message ?? "No se pudo procesar el catálogo");
      setResult(json); await load();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function findFairs() {
    setFinding(true); setError(""); setFinderInfo("");
    try {
      const response = await fetch("/api/v1/leads/trade-fairs/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword: fairQuery, max: 100 }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error?.message ?? "No se pudieron buscar ferias");
      setFoundFairs(json.fairs ?? []);
      const scanned = (json.diagnostics ?? []).map((item: any) => `${item.organizer}: ${item.events}`).join(" · ");
      setFinderInfo(`${json.fairs?.length ?? 0} próximas ferias encontradas${scanned ? ` · ${scanned}` : ""}`);
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setFinding(false); }
  }

  function chooseFair(fair: any) {
    setForm((current) => ({ ...current, name: fair.name, url: fair.catalogUrl ?? fair.url, venue: fair.venue, startsAt: fair.startsAt, endsAt: fair.endsAt }));
    document.getElementById("trade-fair-import-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const field = (key: keyof typeof form, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5">
        <div className="text-base font-semibold text-sky-950">🔎 Buscador automático de próximas ferias</div>
        <p className="mt-1 text-sm text-sky-900/80">Rastrea los calendarios de IFEMA Madrid, Fira Barcelona, Feria Valencia y Bilbao Exhibition Centre. La búsqueda no crea leads ni envía mensajes.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" value={fairQuery} onChange={(e) => setFairQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void findFairs(); }} placeholder="Filtrar por sector, feria, ciudad… (vacío = todas)" />
          <button onClick={findFairs} disabled={finding} className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{finding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar ferias</button>
        </div>
        {finderInfo && <p className="mt-2 text-xs text-slate-600">{finderInfo}</p>}
        {!!foundFairs.length && <div className="mt-4 max-h-[430px] overflow-auto rounded-lg border bg-white">
          {foundFairs.map((fair) => <div key={`${fair.url}-${fair.startsAt}`} className="flex flex-wrap items-center justify-between gap-3 border-b p-3 last:border-0">
            <div className="min-w-0"><div className="font-semibold text-slate-800">{fair.name}</div><div className="text-xs text-slate-500">{fair.startsAt} → {fair.endsAt} · {fair.venue} · {fair.organizer}</div><div className={`mt-0.5 text-xs ${fair.catalogUrl ? "text-emerald-700" : "text-amber-700"}`}>{fair.catalogUrl ? "Catálogo de expositores localizado" : "Evento localizado; catálogo no publicado todavía"}</div></div>
            <div className="flex gap-2"><a href={fair.url} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Ver feria</a><button onClick={() => chooseFair(fair)} className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white">Usar en robot</button></div>
          </div>)}
        </div>}
      </div>
      <div id="trade-fair-import-form" className="scroll-mt-4 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
        <div className="text-base font-semibold text-violet-950">🎪 Robot de expositores — amplificar el stand</div>
        <p className="mt-1 max-w-4xl text-sm text-violet-900/80">
          Importa el catálogo de una feria, extrae y enriquece los contactos de sus expositores y prepara un WhatsApp ofreciendo anuncios geolocalizados alrededor del recinto durante las fechas exactas del evento.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">Nombre de la feria<input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.name} onChange={(e) => field("name", e.target.value)} placeholder="Genera 2026" /></label>
          <label className="text-xs font-medium text-slate-700">Recinto y ciudad<input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.venue} onChange={(e) => field("venue", e.target.value)} placeholder="IFEMA Madrid" /></label>
          <label className="text-xs font-medium text-slate-700 md:col-span-2">URL pública del catálogo de expositores<input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.url} onChange={(e) => field("url", e.target.value)} placeholder="https://…/catalogo-expositores" /></label>
          <label className="text-xs font-medium text-slate-700">Primer día<input type="date" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.startsAt} onChange={(e) => field("startsAt", e.target.value)} /></label>
          <label className="text-xs font-medium text-slate-700">Último día<input type="date" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.endsAt} onChange={(e) => field("endsAt", e.target.value)} /></label>
          <label className="text-xs font-medium text-slate-700">Máximo de expositores<input type="number" min={1} max={300} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={form.maxExhibitors} onChange={(e) => field("maxExhibitors", Number(e.target.value))} /></label>
          <label className="flex items-center gap-2 self-end rounded-lg border bg-white px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={form.autoQueue} onChange={(e) => field("autoQueue", e.target.checked)} />Encolar WhatsApp automáticamente</label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={run} disabled={busy || !form.name || !form.url || !form.venue || !form.startsAt || !form.endsAt} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Extraer expositores
          </button>
          <span className="text-xs text-slate-500">Por seguridad, el envío automático viene desactivado.</span>
        </div>
        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
        {result && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {result.discovered} fichas detectadas · {result.imported} leads nuevos · {result.skipped} duplicados · {result.queued} WhatsApp en cola.</p>}
      </div>
      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 text-sm font-semibold text-slate-800">Ferias procesadas</div>
        {!history.length ? <p className="p-4 text-sm text-slate-500">Todavía no se ha procesado ninguna feria.</p> : history.map((item) => {
          const cfg = item.sourceConfig ?? {};
          return <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm last:border-0"><div><b>{item.keyword}</b><div className="text-xs text-slate-500">{item.location} · {cfg.startsAt} → {cfg.endsAt}</div></div><div className="text-right"><b>{item.totalResults}</b> leads<div className="text-xs text-slate-500">{item.leadsSkipped ?? 0} duplicados · {item.status}</div></div></div>;
        })}
      </div>
    </div>
  );
}

function FranchisesView() {
  const [brand, setBrand] = useState("");
  const [brandLocation, setBrandLocation] = useState("");
  const [brandSearching, setBrandSearching] = useState(false);
  const [brandResult, setBrandResult] = useState<{ searchId: string; totalProvinces: number } | null>(null);
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [brands, setBrands] = useState<{ name: string; sampleCount: number; checked: boolean; contacted?: boolean }[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [diag, setDiag] = useState<{ proposed: number; verified: number; placesErrors: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [dirResult, setDirResult] = useState<{ imported: number; withEmail: number; scanned: number; contacts: any[] } | null>(null);

  async function searchBrandLocations() {
    if (brand.trim().length < 2) { setErr("Escribe una marca (ej: Alcampo)."); return; }
    setBrandSearching(true); setErr(null); setBrandResult(null);
    try {
      const nationwide = !brandLocation.trim();
      const r = await fetch("/api/v1/leads/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: brand.trim(),
          location: brandLocation.trim(),
          scope: nationwide ? "spain" : "custom",
          source: "places",
          skipExisting: true,
          sourceConfig: { brandSearch: true }
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error?.message ?? "No se pudo iniciar la búsqueda por marca."); return; }
      setBrandResult(j);
    } finally { setBrandSearching(false); }
  }

  async function importDirectory() {
    setImporting(true);
    setErr(null);
    try {
      const r = await fetch("/api/v1/leads/franchises/import-directory", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error?.message ?? "Error al importar del directorio."); return; }
      setDirResult(j);
    } finally { setImporting(false); }
  }

  async function discover() {
    if (niche.trim().length < 2) { setErr("Escribe un nicho (ej: heladerías, ópticas, gimnasios)."); return; }
    setDiscovering(true); setErr(null); setResults(null); setDiag(null);
    try {
      const r = await fetch("/api/v1/leads/franchises/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ niche: niche.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error?.message ?? "Error al buscar franquicias."); return; }
      // Las ya contactadas NO se marcan por defecto (evita re-insistir/gastar créditos).
      const list = (j.brands ?? []).map((b: any) => ({ name: b.name, sampleCount: b.sampleCount, contacted: !!b.contacted, checked: !b.contacted }));
      setBrands(list);
      setDiag({ proposed: j.proposed ?? list.length, verified: list.length, placesErrors: j.placesErrors ?? 0 });
      if (list.length === 0) {
        setErr(
          (j.placesErrors ?? 0) > 0
            ? `Google Places no respondió (cuota/límite) en ${j.placesErrors} de ${j.proposed} marcas propuestas. Revisa la cuota/billing de Places en Google Cloud y reintenta.`
            : "No se han verificado franquicias de ese nicho. Prueba otro término."
        );
      }
    } finally { setDiscovering(false); }
  }

  function toggle(name: string) {
    setBrands((prev) => (prev ?? []).map((b) => (b.name === name ? { ...b, checked: !b.checked } : b)));
  }

  async function analyze() {
    const selected = (brands ?? []).filter((b) => b.checked).map((b) => b.name);
    if (selected.length === 0) { setErr("Selecciona al menos una franquicia."); return; }
    setAnalyzing(true); setErr(null);
    try {
      const r = await fetch("/api/v1/leads/franchises/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brands: selected, location: location.trim() || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error?.message ?? "Error al analizar."); return; }
      setResults(j.results ?? []);
    } finally { setAnalyzing(false); }
  }

  const selCount = (brands ?? []).filter((b) => b.checked).length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
        <div className="text-sm font-semibold text-slate-800">🏪 Locales por marca — buscar y contactar cada establecimiento</div>
        <p className="mt-1 text-[11px] text-slate-600">
          Escribe una cadena concreta, por ejemplo <strong>Alcampo</strong>. El Hub recorrerá España por provincias,
          conservará solo locales cuyo nombre corresponda a esa marca y los añadirá como leads normales con sus datos
          de Google. Después podrás seleccionarlos y contactar desde la tabla de leads.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca (ej: Alcampo)" className="px-3 py-2 rounded-lg border bg-white text-sm" />
          <input value={brandLocation} onChange={(e) => setBrandLocation(e.target.value)} placeholder="Provincia/zona (vacío = España)" className="px-3 py-2 rounded-lg border bg-white text-sm" />
          <button onClick={() => void searchBrandLocations()} disabled={brandSearching} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50">
            {brandSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar locales de la marca
          </button>
        </div>
        {brandResult && (
          <div className="mt-2 rounded-md border border-blue-200 bg-white px-2.5 py-2 text-[11px] text-blue-800">
            ✅ Búsqueda iniciada en {brandResult.totalProvinces} zonas. Se procesará automáticamente y los locales aparecerán en la tabla de leads, agrupados bajo “{brand.trim()}”.
          </div>
        )}
      </div>
      <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
        <div className="text-sm font-semibold text-slate-800">🏢 Franquicias — captar la CENTRAL (gestión de toda la red con GMB HUB)</div>
        <p className="text-[11px] text-slate-600 mt-1">
          Elige un nicho → la IA propone franquicias reales (verificadas en Google) → seleccionas → analizamos la
          <strong> salud de red</strong> de cada marca (dispersión de valoraciones, fichas sin web, locales invisibles…)
          y redactamos el <strong>informe + email a la central</strong> ofreciendo gestionar todas sus fichas de forma
          centralizada. Los emails quedan en <strong>📧 Empleos → cola de revisión</strong> para que los apruebes.
        </p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Nicho (ej: heladerías, ópticas, gimnasios)" className="sm:col-span-2 px-3 py-2 rounded-lg border bg-white text-sm" />
          <button onClick={() => void discover()} disabled={discovering} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
            {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar franquicias
          </button>
        </div>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Provincia/zona (opcional; vacío = toda España)" className="mt-2 w-full px-3 py-2 rounded-lg border bg-white text-sm" />
        {err && <div className="mt-2 text-[11px] text-rose-700">{err}</div>}
        {diag && (
          <div className="mt-2 text-[11px] text-slate-500">
            IA propuso <strong>{diag.proposed}</strong> · verificadas en Google <strong>{diag.verified}</strong>
            {diag.placesErrors > 0 && <span className="text-amber-700"> · Google no respondió en <strong>{diag.placesErrors}</strong> (cuota/límite de Places)</span>}
          </div>
        )}
      </div>

      {/* Vía "a lo seguro": importar franquicias con contacto REAL de los directorios. */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold text-slate-800">📇 Franquicias con contacto verificado (directorios)</div>
          <button onClick={() => void importDirectory()} disabled={importing} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "📇"} Importar del directorio
          </button>
        </div>
        <p className="text-[11px] text-slate-600 mt-1">
          Scrapea los portales de franquicias (nombre, persona de contacto de expansión/marketing, teléfono, web) y
          deduce el email con Hunter. Trabajas directamente con las que tienen <strong>contacto que funciona</strong>.
        </p>
        {dirResult && (
          <div className="mt-2">
            <div className="text-[11px] text-slate-600 mb-1">
              Analizadas {dirResult.scanned} fichas · <strong>{dirResult.imported}</strong> importadas · <strong className="text-emerald-700">{dirResult.withEmail}</strong> con email
            </div>
            {Array.isArray((dirResult as any).perDirectory) && (
              <div className="text-[10px] text-slate-500 mb-1">
                {(dirResult as any).perDirectory.map((d: any, i: number) => (
                  <span key={i} className="mr-2">
                    {d.name}: {d.listOk ? `${d.fichas} fichas · ${d.withEmail} con email` : <span className="text-rose-600">no se pudo leer el listado</span>}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {(dirResult.contacts ?? []).map((c: any, i: number) => (
                <div key={i} className={"rounded border px-2.5 py-1.5 text-[11px] " + (c.email ? "border-emerald-200 bg-white" : "border-slate-200 bg-slate-50/60")}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800">{c.brand}{c.sector ? ` · ${c.sector}` : ""}</span>
                    {c.email ? <span className="text-emerald-700">✅ {c.email}</span> : <span className="text-slate-400">sin email</span>}
                  </div>
                  <div className="text-slate-500">
                    {c.contactName ? `👤 ${c.contactName}${c.role ? ` (${c.role})` : ""}` : "sin contacto"}
                    {c.phone ? ` · ${c.phone}` : ""}
                    {c.corporateWeb ? ` · ${c.corporateWeb}` : ""}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Guardadas como leads de central. Analiza una marca arriba para generar su informe + email a ese contacto.</p>
          </div>
        )}
      </div>

      <DecisionMakerKeys />

      {brands && brands.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-semibold text-slate-800">Franquicias encontradas ({brands.length})</div>
            <button onClick={() => void analyze()} disabled={analyzing || selCount === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : "🔬"} Analizar seleccionadas ({selCount})
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {brands.map((b) => (
              <label key={b.name} className={"flex items-center gap-2 p-2 rounded border cursor-pointer text-sm " + (b.contacted ? "bg-rose-50/60 border-rose-200" : "bg-slate-50/60")}>
                <input type="checkbox" checked={b.checked} onChange={() => toggle(b.name)} className="accent-violet-600" />
                <span className="flex-1 truncate">{b.name}</span>
                {b.contacted && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 border border-rose-300 px-2 py-0.5 text-[10px] font-semibold text-rose-700">⛔ Ya contactada</span>
                )}
                <span className="text-[11px] text-slate-400">{b.sampleCount}+ fichas</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {results && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-sm font-semibold text-slate-800 mb-2">Resultado del análisis</div>
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.brand} className="rounded-md border border-slate-200 p-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm font-semibold text-slate-800">{r.brand}</div>
                  {r.error ? (
                    <span className="text-[11px] text-amber-700">{r.error}</span>
                  ) : r.status === "contacted" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 border border-rose-300 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                      ⛔ Ya contactada — no insistir{r.contactedAt ? ` (${new Date(r.contactedAt).toLocaleDateString("es-ES")})` : ""}
                    </span>
                  ) : r.status === "draft_pending" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      📝 Ya tiene borrador en la cola (sin enviar)
                    </span>
                  ) : r.status === "drafted_now" || r.emailed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      ✅ Email creado en la cola de revisión
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">Sin email de central localizable</span>
                  )}
                </div>
                {r.metrics && (
                  <div className="mt-1 text-[11px] text-slate-600">
                    {r.metrics.sampled} fichas · media {r.metrics.avgRating ?? "—"}★ (de {r.metrics.minRating ?? "—"} a {r.metrics.maxRating ?? "—"}) ·
                    {" "}{r.metrics.lowRatingPct}% bajo 3,5★ · {r.metrics.noWebsitePct}% sin web · {r.metrics.noReviewsPct}% casi sin reseñas
                  </div>
                )}
                {(r.contact?.name || r.contact?.email || r.contact?.linkedin) && (
                  <div className="mt-1 text-[11px] text-slate-700 flex items-center gap-2 flex-wrap">
                    <span className="font-medium">👤 {r.contact?.name ?? "Responsable de marketing"}{r.contact?.role ? ` · ${r.contact.role}` : ""}</span>
                    {r.contact?.email && <span className="text-slate-500">{r.contact.email}</span>}
                    {r.contact?.linkedin && (
                      <a href={r.contact.linkedin} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">LinkedIn ↗</a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Los emails redactados están en <strong>📧 Empleos → cola de revisión</strong> (misma cola): ahí los editas, apruebas y envías.
          </p>
        </div>
      )}
    </div>
  );
}

function JobsReviewPanel() {
  const [mode, setMode] = useState<"auto" | "review" | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  // Confirmación de envío (para verificar de un vistazo que salió).
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  // Selección múltiple para enviar/descartar en lote.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Empresas de la fuente jobs sin email de contacto (no se les puede enviar).
  const [noEmail, setNoEmail] = useState(0);
  // Texto de la oferta cargado bajo demanda (LinkedIn no lo trae en la búsqueda).
  const [descs, setDescs] = useState<Record<string, string>>({});
  const [descBusy, setDescBusy] = useState<string | null>(null);

  async function loadDesc(id: string) {
    setDescBusy(id);
    try {
      const r = await fetch(`/api/v1/leads/jobs-review/${id}/description`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error?.message ?? "No se pudo cargar el texto de la oferta.");
        return;
      }
      setDescs((p) => ({ ...p, [id]: j.description || "(La oferta no expone texto legible; ábrela con “Ver oferta ↗”)" }));
    } finally {
      setDescBusy(null);
    }
  }

  async function loadMode() {
    try {
      const r = await fetch("/api/v1/leads/settings");
      if (r.ok) {
        const j = await r.json();
        setMode(j.jobsReviewMode === false ? "auto" : "review");
      }
    } catch {}
  }
  async function loadItems() {
    try {
      const r = await fetch("/api/v1/leads/jobs-review");
      if (r.ok) {
        const j = await r.json();
        const list = j.items ?? [];
        setItems(list);
        setNoEmail(j.noEmailCount ?? 0);
        // Poda la selección a los ids que siguen en la cola.
        setSelected((prev) => {
          const ids = new Set(list.map((it: any) => it.id));
          const next = new Set<string>();
          prev.forEach((id) => ids.has(id) && next.add(id));
          return next;
        });
      }
    } catch {}
  }
  useEffect(() => {
    void loadMode();
    void loadItems();
  }, []);
  usePollingChannel(() => void loadItems(), 60_000); // pausable al ocultar pestaña (F2.6)

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const all = items ?? [];
      if (prev.size === all.length) return new Set();
      return new Set(all.map((it) => it.id));
    });
  }

  const [reenriching, setReenriching] = useState(false);
  async function reenrich() {
    setReenriching(true);
    try {
      const r = await fetch("/api/v1/leads/jobs-reenrich", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j?.error?.message ?? "No se pudo re-buscar el email."); return; }
      await loadItems();
      alert(`Revisadas ${j.scanned} empresa(s) sin email: encontrado email en ${j.emailsFound}, ${j.drafted} borrador(es) nuevo(s) en la cola.`);
    } finally {
      setReenriching(false);
    }
  }

  async function generateDrafts() {
    setGenerating(true);
    try {
      const r = await fetch("/api/v1/leads/jobs-review/generate", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error?.message ?? "No se pudieron generar los borradores.");
        return;
      }
      await loadItems();
      if ((j.drafted ?? 0) === 0) {
        alert(
          j.candidates === 0
            ? "No hay empresas de Empleos con email de contacto todavía. Lanza una búsqueda de la fuente Empleos primero."
            : "Todas las empresas con email ya tenían su borrador o secuencia. Nada nuevo que generar."
        );
      }
    } finally {
      setGenerating(false);
    }
  }

  async function bulkAct(action: "approve" | "reject") {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === "reject" && !confirm(`¿Descartar ${ids.length} email(s)? No se enviarán y se detendrá su secuencia.`)) return;
    if (action === "approve" && !confirm(`¿Enviar ${ids.length} email(s) seleccionado(s)? Se enviarán con el texto (editado) actual.`)) return;
    setBulkBusy(true);
    try {
      const payloadItems = ids.map((id) => {
        if (action === "reject") return { id };
        const it = (items ?? []).find((x) => x.id === id);
        const e = edits[id] ?? { subject: it?.subject ?? "", body: it?.body ?? "" };
        return { id, subject: e.subject, body: e.body };
      });
      const r = await fetch("/api/v1/leads/jobs-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, items: payloadItems })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error?.message ?? "No se pudo completar la acción en lote.");
        return;
      }
      if (j.failed > 0) {
        alert(`${j.ok} correcto(s), ${j.failed} con error. Los que fallaron siguen en la cola.`);
      }
      if (action === "approve" && j.ok > 0) {
        setSentMsg(`✅ ${j.ok} email(s) enviado(s). Quedan registrados y esas empresas pasan a "Contactado".`);
      }
      await loadItems();
    } finally {
      setBulkBusy(false);
    }
  }

  async function setModeRemote(next: "auto" | "review") {
    setSavingMode(true);
    try {
      const r = await fetch("/api/v1/leads/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobsReviewMode: next === "review" })
      });
      if (r.ok) setMode(next);
      else alert("No se pudo cambiar el modo.");
    } finally {
      setSavingMode(false);
    }
  }

  async function regen(id: string) {
    setRegenId(id);
    try {
      const r = await fetch(`/api/v1/leads/jobs-review/${id}/regenerate`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error?.message ?? "No se pudo regenerar el email.");
        return;
      }
      // Refresca el texto mostrado (edits) y el guardado (items).
      setEdits((p) => ({ ...p, [id]: { subject: j.subject ?? "", body: j.body ?? "" } }));
      setItems((prev) => (prev ?? []).map((it) => (it.id === id ? { ...it, subject: j.subject, body: j.body } : it)));
    } finally {
      setRegenId(null);
    }
  }

  async function act(id: string, action: "approve" | "reject") {
    if (action === "reject" && !confirm("¿Descartar este email? No se enviará y se detendrá la secuencia de esta empresa.")) return;
    setBusyId(id);
    try {
      const e = edits[id];
      const r = await fetch(`/api/v1/leads/jobs-review/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action, subject: e?.subject, body: e?.body } : { action })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error?.message ?? "No se pudo completar la acción.");
        return;
      }
      if (action === "approve") {
        const co = (items ?? []).find((it) => it.id === id)?.company ?? "la empresa";
        setSentMsg(`✅ Email enviado a ${co}. Queda registrado y la empresa pasa a "Contactado".`);
      }
      setItems((prev) => (prev ?? []).filter((it) => it.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setBusyId(null);
    }
  }

  const pending = items?.length ?? 0;
  const allSelected = pending > 0 && selected.size === pending;

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold text-slate-800">
          📧 Empleos — emails a empresas que buscan marketing/IA
          {pending > 0 && <span className="ml-2 inline-flex items-center rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white">{pending} por revisar</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => void generateDrafts()}
          disabled={generating}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          title="Redacta con IA el email de las empresas de Empleos que tengan email y aún no tengan borrador"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "🪄"} Generar borradores
        </button>
        <div className="inline-flex rounded-md border border-indigo-300 overflow-hidden text-xs">
          <button
            onClick={() => void setModeRemote("review")}
            disabled={savingMode || mode === "review"}
            className={"px-2.5 py-1 " + (mode === "review" ? "bg-indigo-600 text-white font-semibold" : "bg-white text-slate-600 hover:bg-indigo-100")}
            title="Los emails se redactan y esperan tu aprobación antes de enviarse"
          >
            Revisar antes de enviar
          </button>
          <button
            onClick={() => void setModeRemote("auto")}
            disabled={savingMode || mode === "auto"}
            className={"px-2.5 py-1 border-l border-indigo-300 " + (mode === "auto" ? "bg-emerald-600 text-white font-semibold" : "bg-white text-slate-600 hover:bg-emerald-50")}
            title="Los emails se envían solos en cuanto se encuentra la empresa y su email"
          >
            Automático
          </button>
        </div>
        </div>
      </div>
      <div className="text-[11px] text-slate-600 mt-1">
        {mode === "auto"
          ? "Modo automático: al encontrar una empresa con oferta de marketing/IA y su email, el primer correo sale solo (con pie de baja RGPD)."
          : "Modo revisión: al terminar la búsqueda, los correos se redactan con IA y quedan aquí. Selecciona con las casillas cuáles enviar, edítalos a tu gusto y descarta los que no te interesen. Nada sale sin tu visto bueno."}
      </div>
      {sentMsg && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800">
          <span>{sentMsg}</span>
          <button onClick={() => setSentMsg(null)} className="text-emerald-700 hover:text-emerald-900" title="Cerrar">✕</button>
        </div>
      )}
      <JobsInboxConfig onIngested={() => void loadItems()} />
      {noEmail > 0 && (
        <div className="text-[11px] text-amber-700 mt-1 flex items-center gap-2 flex-wrap">
          <span>
            ℹ️ Además hay <strong>{noEmail}</strong> empresa(s) con vacante pero <strong>sin email de contacto</strong> localizable (por teléfono/LinkedIn desde la cola de leads).
          </span>
          <button
            onClick={() => void reenrich()}
            disabled={reenriching}
            className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            title="Vuelve a buscar el email de contacto de esas empresas (extractor mejorado)"
          >
            {reenriching ? <Loader2 className="h-3 w-3 animate-spin" /> : "🔍"} Buscar su email
          </button>
        </div>
      )}

      {/* Estado vacío: nada pendiente de revisar */}
      {items !== null && pending === 0 && (
        <div className="mt-3 rounded-md border border-dashed border-indigo-200 bg-white/60 px-3 py-4 text-center text-xs text-slate-600">
          No hay emails pendientes de revisar ahora mismo.
          {noEmail === 0 && " Lanza una búsqueda de la fuente Empleos (con provincia) y, al completarse, sus borradores aparecerán aquí."}
          <br />
          Si acabas de completar una búsqueda y no ves nada, pulsa <strong>🪄 Generar borradores</strong> para redactarlos ahora.
        </div>
      )}

      {/* Barra de acciones en lote */}
      {pending > 0 && (
        <div className="mt-3 flex items-center gap-2 flex-wrap rounded-md border border-indigo-200 bg-white/70 px-2.5 py-1.5">
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-indigo-600" />
            {allSelected ? "Quitar selección" : "Seleccionar todo"}
          </label>
          <span className="text-[11px] text-slate-500">{selected.size} de {pending} seleccionado(s)</span>
          <div className="flex-1" />
          <button
            onClick={() => void bulkAct("approve")}
            disabled={bulkBusy || selected.size === 0}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "📤"} Enviar seleccionados ({selected.size})
          </button>
          <button
            onClick={() => void bulkAct("reject")}
            disabled={bulkBusy || selected.size === 0}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            🗑 Descartar seleccionados
          </button>
        </div>
      )}

      {pending > 0 && (
        <div className="mt-3 space-y-3">
          {(items ?? []).map((it) => {
            const e = edits[it.id] ?? { subject: it.subject ?? "", body: it.body ?? "" };
            const checked = selected.has(it.id);
            return (
              <div key={it.id} className={"rounded-md border bg-white p-3 " + (checked ? "border-indigo-400 ring-1 ring-indigo-200" : "border-slate-200")}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <label className="flex items-start gap-2 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSel(it.id)}
                      className="mt-0.5 accent-indigo-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 truncate">{it.company}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        → {it.email}
                        {it.directorName ? ` · 👤 ${it.directorName}${it.directorRole ? ` (${it.directorRole})` : ""}` : ""}
                        {it.jobTitle ? ` · Vacante: ${it.jobTitle}` : ""}
                        {it.website ? ` · ${it.website}` : ""}
                      </span>
                      {Array.isArray(it.bccEmails) && it.bccEmails.length > 0 && (
                        <span className="block text-[11px] text-violet-700" title={it.bccEmails.join(", ")}>
                          🔒 CCO a {it.bccEmails.length} directivo(s) de marketing más
                        </span>
                      )}
                    </span>
                  </label>
                  <div className="flex items-center gap-2 shrink-0">
                    {it.linkedin && (
                      <a href={it.linkedin} target="_blank" rel="noreferrer" className="text-[11px] text-violet-600 hover:underline">
                        LinkedIn ↗
                      </a>
                    )}
                    {it.jobUrl && (
                      <a href={it.jobUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-600 hover:underline">
                        Ver oferta ↗
                      </a>
                    )}
                  </div>
                </div>
                {/* Texto de la oferta, para leerla sin abrir el enlace. InfoJobs
                    lo trae ya; LinkedIn se carga bajo demanda con el botón. */}
                {(() => {
                  const desc = it.jobDescription ?? descs[it.id] ?? null;
                  if (desc) {
                    return (
                      <details className="mt-2 rounded border border-slate-200 bg-slate-50/70" open>
                        <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-semibold text-slate-600">
                          {it.jobTitle ? "📄 Oferta de empleo" : "📊 Informe de red"}
                        </summary>
                        <div className="max-h-44 overflow-y-auto whitespace-pre-line px-2.5 pb-2 text-[12px] leading-relaxed text-slate-700">
                          {desc}
                        </div>
                      </details>
                    );
                  }
                  if (it.jobUrl) {
                    return (
                      <button
                        onClick={() => void loadDesc(it.id)}
                        disabled={descBusy === it.id}
                        className="mt-2 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {descBusy === it.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "📄"} Cargar texto de la oferta
                      </button>
                    );
                  }
                  return null;
                })()}
                <input
                  value={e.subject}
                  onChange={(ev) => setEdits((p) => ({ ...p, [it.id]: { subject: ev.target.value, body: e.body } }))}
                  className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm font-medium"
                  placeholder="Asunto"
                />
                <textarea
                  value={e.body}
                  onChange={(ev) => setEdits((p) => ({ ...p, [it.id]: { subject: e.subject, body: ev.target.value } }))}
                  rows={6}
                  className="mt-1.5 w-full rounded border border-slate-300 px-2 py-1 text-sm leading-relaxed"
                  placeholder="Cuerpo del email"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => void act(it.id, "approve")}
                    disabled={busyId === it.id || !e.subject.trim() || !e.body.trim()}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busyId === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "✅"} Aprobar y enviar
                  </button>
                  <button
                    onClick={() => void regen(it.id)}
                    disabled={regenId === it.id || busyId === it.id}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    title="Vuelve a redactar el email con IA (aplica el mensaje/discurso actual)"
                  >
                    {regenId === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "🔄"} Regenerar
                  </button>
                  <button
                    onClick={() => void act(it.id, "reject")}
                    disabled={busyId === it.id}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    🗑 Descartar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QueueTable({ loading, items, onChanged }: { loading: boolean; items: QueueRow[]; onChanged: () => void }) {
  const [processing, setProcessing] = useState(false);
  const [tickResult, setTickResult] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [diag, setDiag] = useState<any | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [sendingNowId, setSendingNowId] = useState<string | null>(null);
  // Papelera / deshacer: ids de los últimos mensajes enviados a papelera.
  const [lastTrashed, setLastTrashed] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);
  async function restoreTrashed() {
    if (lastTrashed.length === 0) return;
    setRestoring(true);
    try {
      const r = await fetch("/api/v1/leads/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: lastTrashed })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.message ?? "No se pudo restaurar.");
      } else {
        setLastTrashed([]);
        onChanged();
      }
    } finally {
      setRestoring(false);
    }
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Envío masivo de imagen de posicionamiento a leads pendientes contactables.
  const [rankOpen, setRankOpen] = useState(false);
  const [rankIds, setRankIds] = useState<string[]>([]);
  const [rankLoading, setRankLoading] = useState(false);
  const [previewRow, setPreviewRow] = useState<QueueRow | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [savingPreview, setSavingPreview] = useState(false);
  const [geoWarn, setGeoWarn] = useState<{ leadProvince: string | null; detectedProvince: string | null } | null>(null);
  const [fixingGeo, setFixingGeo] = useState(false);
  async function fixGeo() {
    if (!previewRow) return;
    setFixingGeo(true);
    try {
      const r = await fetch(`/api/v1/leads/${previewRow.leadId}/fix-geo`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d?.error?.message ?? "No se pudo corregir la ubicación."); return; }
      setGeoWarn(null);
      onChanged(); // recarga la cola con el texto/imagen ya corregidos
      setPreviewRow(null); // ciérralo; al reabrir verás la versión corregida
    } finally {
      setFixingGeo(false);
    }
  }
  useEffect(() => { setPreviewText(previewRow?.renderedMessage ?? ""); }, [previewRow]);
  // Aviso de geo incoherente (coords del lead en otra provincia → ranking malo).
  useEffect(() => {
    setGeoWarn(null);
    if (!previewRow || previewRow.kind !== "ranking") return;
    let cancel = false;
    fetch(`/api/v1/leads/${previewRow.leadId}/geo-check`)
      .then((r) => r.json())
      .then((d) => { if (!cancel && d?.mismatch) setGeoWarn({ leadProvince: d.leadProvince, detectedProvince: d.detectedProvince }); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [previewRow]);
  async function savePreviewText() {
    if (!previewRow) return;
    setSavingPreview(true);
    try {
      const r = await fetch(`/api/v1/leads/queue/${previewRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: previewText })
      });
      if (r.ok) { onChanged(); setPreviewRow(null); }
    } finally {
      setSavingPreview(false);
    }
  }
  const [pendingMobile, setPendingMobile] = useState<number | null>(null);
  // Filtros del envío masivo de imagen.
  const [rankOnlyPending, setRankOnlyPending] = useState(true);
  const [rankExcludeManaged, setRankExcludeManaged] = useState(true);
  const [rankProvince, setRankProvince] = useState("");
  const [rankSearchId, setRankSearchId] = useState("");
  const [rankSearches, setRankSearches] = useState<{ id: string; keyword: string; location: string }[]>([]);
  useEffect(() => {
    fetch("/api/v1/leads/searches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRankSearches(Array.isArray(d?.items) ? d.items : []))
      .catch(() => {});
  }, []);
  const rankQs = () =>
    `onlyPending=${rankOnlyPending ? 1 : 0}&excludeManaged=${rankExcludeManaged ? 1 : 0}` +
    (rankProvince ? `&province=${encodeURIComponent(rankProvince)}` : "") +
    (rankSearchId ? `&searchId=${encodeURIComponent(rankSearchId)}` : "");
  // Contador en vivo de candidatos según los filtros elegidos.
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/leads/ranking-candidates?${rankQs()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && typeof d?.count === "number") setPendingMobile(d.count); })
      .catch(() => {});
    return () => { alive = false; };
  }, [items, rankOnlyPending, rankExcludeManaged, rankProvince, rankSearchId]);
  async function openRankingBlast() {
    setRankLoading(true);
    try {
      const r = await fetch(`/api/v1/leads/ranking-candidates?${rankQs()}`);
      const d = await r.json().catch(() => ({}));
      const ids: string[] = Array.isArray(d?.ids) ? d.ids : [];
      if (typeof d?.count === "number") setPendingMobile(d.count);
      setRankIds(ids);
      setRankOpen(true);
    } finally {
      setRankLoading(false);
    }
  }
  // Reprogramado masivo (re-paginado de la cola)
  const [repaceOpen, setRepaceOpen] = useState(false);
  const [repaceFrom, setRepaceFrom] = useState("");
  const [repacing, setRepacing] = useState(false);
  // Edición de fecha de una fila concreta
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [editDateVal, setEditDateVal] = useState("");
  const [savingDateId, setSavingDateId] = useState<string | null>(null);
  // Números emisores disponibles (multi-número) para la columna "Enviar desde".
  const [channels, setChannels] = useState<{ name: string; label?: string | null }[]>([]);
  const [savingChanId, setSavingChanId] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/v1/leads/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setChannels(Array.isArray(d?.channels) ? d.channels.filter((c: any) => c?.name) : []))
      .catch(() => {});
  }, []);
  function channelLabel(name: string | null | undefined): string {
    if (!name) return "Principal";
    const c = channels.find((x) => x.name === name);
    return c?.label?.trim() || name;
  }
  async function changeChannel(id: string, value: string) {
    setSavingChanId(id);
    try {
      const r = await fetch(`/api/v1/leads/queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: value })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d?.error?.message ?? `No se pudo cambiar el número (${r.status})`);
      }
    } finally {
      setSavingChanId(null);
      onChanged();
    }
  }

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

  async function refreshRendered() {
    if (!confirm("¿Re-renderizar el texto de los mensajes EN COLA? Recogerán las correcciones del motor (p. ej. posición/competidor del ranking). Cubre plantillas y secuencias.")) return;
    setProcessing(true);
    setTickResult(null);
    try {
      const r = await fetch("/api/v1/leads/queue/refresh-rendered", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 500 })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setTickResult({ kind: "error", text: d?.error?.message ?? `Error HTTP ${r.status}` });
      else setTickResult({ kind: "ok", text: `✓ ${d.refreshed} textos actualizados${d.sinFuente ? ` · ${d.sinFuente} sin fuente (revisar a mano)` : ""}.` });
    } catch (e: any) {
      setTickResult({ kind: "error", text: e?.message ?? "Error de red" });
    } finally {
      setProcessing(false);
      onChanged();
    }
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
          recipient_opted_out: "El destinatario pidió no ser contactado (opt-out) o el lead está bloqueado; mensaje cancelado.",
          no_eligible_due: "Todos los mensajes vencidos están en cool-down. Pulsa \"⏫ Priorizar cola\" para adelantar leads nuevos (o espera: se reordena solo).",
          new_chats_daily_cap: "Tope de NUEVAS conversaciones por hoy alcanzado. Reprogramado para mañana.",
          pacing_wait: "Aún no toca: hay que esperar el delay mínimo desde el último envío.",
          session_down: "El número asignado no está conectado en WhatsApp ahora mismo; se reintenta al reconectar.",
          no_session: "No hay NINGÚN número conectado para enviar. Reconecta un número en Ajustes → Conectar.",
          auto_recovery_triggered: "Modo recuperación ACTIVO por un pico de fallos: límites endurecidos temporalmente. Revisa Ajustes → recuperación.",
          blocked_link_first_message: "El primer mensaje llevaba un enlace y se bloqueó (anti-baneo). Quita el link del opener.",
          warmup_cap_deferred: "El número está en calentamiento y ya llegó a su cupo de hoy; reprogramado para mañana."
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
  async function prioritize() {
    setProcessing(true);
    setTickResult(null);
    try {
      const r = await fetch("/api/v1/leads/queue/prioritize", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTickResult({ kind: "error", text: d?.message ?? `Error HTTP ${r.status}` });
      } else {
        setTickResult({
          kind: "ok",
          text:
            `✓ Cola reordenada: ${d.newContacts ?? 0} nunca contactados + ${d.recontacts ?? 0} fuera de cool-down al frente` +
            ` · ${d.parkedCooldown ?? 0} en cool-down aparcados` +
            (d.canceled ? ` · ${d.canceled} cancelados (opt-out)` : "") +
            `. Empezará a enviar los nuevos en el próximo minuto.`
        });
      }
    } catch (e: any) {
      setTickResult({ kind: "error", text: e?.message ?? "Error de red" });
    } finally {
      setProcessing(false);
      onChanged();
    }
  }
  async function runDiagnose() {
    setDiagLoading(true);
    setDiag(null);
    try {
      const r = await fetch("/api/v1/leads/queue/diagnose");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTickResult({ kind: "error", text: d?.message ?? `Error HTTP ${r.status}` });
      } else {
        setDiag(d);
      }
    } catch (e: any) {
      setTickResult({ kind: "error", text: e?.message ?? "Error de red" });
    } finally {
      setDiagLoading(false);
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
  async function retryOne(id: string) {
    setSendingNowId(id);
    try {
      const r = await fetch("/api/v1/leads/queue/retry-failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d?.message ?? "No se pudo reintentar.");
      onChanged();
    } finally {
      setSendingNowId(null);
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
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.message ?? "No se pudo borrar.");
      } else if (j?.soft && j?.id) {
        setLastTrashed([j.id]);
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
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.message ?? "No se pudieron borrar.");
      } else {
        setLastTrashed(Array.isArray(j?.cancelledIds) ? j.cancelledIds : []);
      }
      setSelected(new Set());
      onChanged();
    } finally {
      setBulkDeleting(false);
    }
  }

  // Convierte un valor <input type="datetime-local"> (hora local) a ISO.
  function localInputToIso(v: string): string | null {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Da el valor para un <input datetime-local> a partir de una fecha (hora local).
  function toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openRepace() {
    setRepaceFrom(toLocalInput(new Date()));
    setRepaceOpen(true);
  }
  async function doRepace() {
    const iso = localInputToIso(repaceFrom);
    const ids = Array.from(selected);
    const scope = ids.length > 0 ? `${ids.length} seleccionado(s)` : "TODA la cola pendiente";
    if (!confirm(`¿Reprogramar ${scope} a partir de ${repaceFrom || "ahora"}? Se respeta la ventana horaria, el tope diario y el espaciado anti-baneo.`)) return;
    setRepacing(true);
    setTickResult(null);
    try {
      const r = await fetch("/api/v1/leads/queue/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: iso ?? undefined,
          ids: ids.length > 0 ? ids : undefined
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTickResult({ kind: "error", text: d?.message ?? `Error HTTP ${r.status}` });
      } else {
        const first = d?.firstAt ? new Date(d.firstAt).toLocaleString("es-ES") : "—";
        const last = d?.lastAt ? new Date(d.lastAt).toLocaleString("es-ES") : "—";
        setTickResult({
          kind: "ok",
          text: `✓ ${d?.updated ?? 0} mensaje(s) reprogramado(s). Primero: ${first} · Último: ${last}.`
        });
        setRepaceOpen(false);
        setSelected(new Set());
      }
    } catch (e: any) {
      setTickResult({ kind: "error", text: e?.message ?? "Error de red" });
    } finally {
      setRepacing(false);
      onChanged();
    }
  }

  function startEditDate(m: QueueRow) {
    setEditingDateId(m.id);
    setEditDateVal(m.scheduledAt ? toLocalInput(new Date(m.scheduledAt)) : toLocalInput(new Date()));
  }
  async function saveEditDate(id: string) {
    const iso = localInputToIso(editDateVal);
    if (!iso) {
      alert("Fecha inválida.");
      return;
    }
    setSavingDateId(id);
    try {
      const r = await fetch(`/api/v1/leads/queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: iso })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.message ?? "No se pudo reprogramar.");
      } else {
        setEditingDateId(null);
      }
      onChanged();
    } finally {
      setSavingDateId(null);
    }
  }

  if (loading) return <Loading />;
  return (
    <div className="space-y-3">
      <QueueLiveStatus />
      {lastTrashed.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs">
          <span>🗑 {lastTrashed.length} mensaje{lastTrashed.length === 1 ? "" : "s"} en la papelera (no se enviarán).</span>
          <button
            onClick={restoreTrashed}
            disabled={restoring}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-white hover:bg-slate-100 font-medium disabled:opacity-50"
          >
            {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "↩︎"} Deshacer
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={tick}
          disabled={processing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-xs disabled:opacity-50"
        >
          {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Procesar siguiente
        </button>
        <button
          onClick={runDiagnose}
          disabled={diagLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs disabled:opacity-50"
          title="Revisa de una vez TODOS los motivos por los que la cola podría no estar enviando (pausa, ventana horaria, topes, cool-down, conexión de cada número, enlaces en el opener) y da un veredicto claro."
        >
          {diagLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "🩺"}
          Diagnóstico
        </button>
        <button
          onClick={prioritize}
          disabled={processing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs disabled:opacity-50"
          title="Reordena la cola: pone al frente los leads NUNCA contactados y los que ya salieron del cool-down, y aparca los que están en cool-down. Hace que la cola envíe con volumen en vez de a goteo. No cambia topes ni ventana."
        >
          {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "⏫"}
          Priorizar cola
        </button>
        <button
          onClick={refreshRendered}
          disabled={processing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs disabled:opacity-50"
          title="Re-renderiza el texto de los mensajes en cola que vienen de plantilla (recoge correcciones como la posición/competidor del ranking)"
        >
          🔄 Refrescar textos
        </button>
        <button
          onClick={openRankingBlast}
          disabled={rankLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs disabled:opacity-50"
          title="Enviar la captura de Google (tú vs competencia) a los leads que cumplen el filtro"
        >
          {rankLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          📊 Imagen de posicionamiento {pendingMobile != null ? `(${pendingMobile})` : ""}
        </button>
        <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer" title="Solo leads en estado Pendiente (no contactados)">
          <input type="checkbox" checked={rankOnlyPending} onChange={(e) => setRankOnlyPending(e.target.checked)} className="accent-emerald-600" />
          Solo pendientes
        </label>
        <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer" title="Excluir leads que ya tienen conversación en el inbox (los que estás gestionando)">
          <input type="checkbox" checked={rankExcludeManaged} onChange={(e) => setRankExcludeManaged(e.target.checked)} className="accent-emerald-600" />
          Excluir ya gestionados
        </label>
        <select
          value={rankProvince}
          onChange={(e) => setRankProvince(e.target.value)}
          className="text-[11px] px-1.5 py-1 rounded border bg-white max-w-[140px]"
          title="Filtrar por provincia"
        >
          <option value="">Toda provincia</option>
          {PROVINCE_NAMES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={rankSearchId}
          onChange={(e) => setRankSearchId(e.target.value)}
          className="text-[11px] px-1.5 py-1 rounded border bg-white max-w-[180px]"
          title="Filtrar por una búsqueda/captación concreta"
        >
          <option value="">Cualquier búsqueda</option>
          {rankSearches.map((s) => (
            <option key={s.id} value={s.id}>{s.keyword} · {s.location}</option>
          ))}
        </select>
        {items.some((m) => m.status === "queued") && (
          <button
            onClick={openRepace}
            disabled={repacing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs disabled:opacity-50"
            title="Redistribuye los mensajes en cola a partir de una fecha (por defecto, ahora), respetando ventana horaria y anti-baneo. Útil cuando la cola no empieza a enviar hasta dentro de varios días."
          >
            {repacing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
            Reprogramar {selected.size > 0 ? `${selected.size} sel.` : "cola"}
          </button>
        )}
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
        {(() => {
          const sentToday = items.filter(isSentTodayRow).length;
          return sentToday > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
              ✅ {sentToday} enviados hoy
            </span>
          ) : null;
        })()}
      </div>
      {repaceOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
          <span className="text-xs text-indigo-800">
            Reprogramar {selected.size > 0 ? `${selected.size} seleccionado(s)` : "toda la cola"} a partir de:
          </span>
          <input
            type="datetime-local"
            value={repaceFrom}
            onChange={(e) => setRepaceFrom(e.target.value)}
            className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white"
          />
          <button
            onClick={doRepace}
            disabled={repacing}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs disabled:opacity-50"
          >
            {repacing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Aplicar
          </button>
          <button
            onClick={() => setRepaceOpen(false)}
            disabled={repacing}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
          >
            Cancelar
          </button>
        </div>
      )}
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
      {diag && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-sky-900 text-sm">🩺 {diag.verdict}</div>
              <div className="text-slate-700 mt-0.5">{diag.detail}</div>
            </div>
            <button
              onClick={() => setDiag(null)}
              className="shrink-0 text-slate-400 hover:text-slate-700 text-base leading-none"
              title="Cerrar"
            >
              ✕
            </button>
          </div>

          {/* Sesiones (números) */}
          <div>
            <div className="font-medium text-slate-600 mb-1">Números de WhatsApp</div>
            <div className="flex flex-wrap gap-1.5">
              {diag.sessions?.map((s: any, i: number) => (
                <span
                  key={i}
                  className={
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border " +
                    (s.connected === true
                      ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                      : s.connected === false
                        ? "bg-rose-50 border-rose-300 text-rose-800"
                        : "bg-slate-50 border-slate-300 text-slate-600")
                  }
                  title={s.status}
                >
                  {s.connected === true ? "🟢" : s.connected === false ? "🔴" : "⚪️"} {s.name} · {s.role}{" "}
                  <span className="opacity-70">({s.status})</span>
                </span>
              ))}
            </div>
          </div>

          {/* Contadores + cola */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ["Ahora", diag.now + (diag.insideWindow ? " · en ventana ✅" : " · fuera de ventana ⛔")],
              ["Ventana", `${diag.settings.window}${diag.settings.sendOnWeekends ? "" : " (L-V)"}`],
              ["Enviados hoy", `${diag.counters.sentToday} mensajes`],
              ["Programados hoy", `${diag.queue.scheduledToday ?? 0} mensajes`],
              ["Límite diario", `${diag.settings.dailyLimitEffective} mensajes`],
              ["Última hora", `${diag.counters.sentLastHour} / ${diag.settings.maxPerHour}`],
              ["Cool-down", `${diag.settings.cooldownDays} días`],
              ["Chats nuevos/día", `${diag.counters.newChatsToday} / ${diag.settings.maxNewChatsPerDay}`],
              ["Pendientes en cola", `${diag.queue.queued} (${diag.queue.dueNow} listos ahora)`],
              ["Último envío", diag.counters.lastSentAt ?? "—"]
            ].map(([k, v], i) => (
              <div key={i} className="rounded border border-sky-100 bg-white px-2 py-1">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
                <div className="text-slate-800 font-medium">{v}</div>
              </div>
            ))}
          </div>
          {(diag.settings.recoveryMode || diag.queue.failed > 0 || diag.queue.blockedLink > 0 || diag.queue.sending > 0) && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              {diag.settings.recoveryMode && (
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                  ⚠️ Modo recuperación ACTIVO (límites endurecidos)
                </span>
              )}
              {diag.settings.warmupCap != null && (
                <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                  🔥 Calentamiento: tope efectivo {diag.settings.warmupCap}/día
                </span>
              )}
              {diag.queue.sending > 0 && (
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border">{diag.queue.sending} en “enviando”</span>
              )}
              {diag.queue.failed > 0 && (
                <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">{diag.queue.failed} fallidos</span>
              )}
              {diag.queue.blockedLink > 0 && (
                <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">{diag.queue.blockedLink} bloqueados por enlace</span>
              )}
            </div>
          )}

          {/* Muestra de mensajes vencidos y su bloqueo */}
          {diag.sample?.length > 0 && (
            <div>
              <div className="font-medium text-slate-600 mb-1">Próximos mensajes vencidos</div>
              <div className="space-y-0.5">
                {diag.sample.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-2 bg-white rounded border border-sky-100 px-2 py-1">
                    <span className="font-mono text-slate-700">{s.phone}</span>
                    <span className="text-slate-400">{s.channel}</span>
                    <span
                      className={
                        "font-medium " +
                        (s.blocker === "listo para enviar" ? "text-emerald-700" : "text-amber-700")
                      }
                    >
                      {s.blocker}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                <th className="text-left px-3 py-2.5">Enviar desde</th>
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
                const sentToday = isSentTodayRow(m);
                return (
                  <tr
                    key={m.id}
                    className={
                      sentToday
                        ? "bg-emerald-100 hover:bg-emerald-200 border-l-4 border-emerald-500"
                        : "hover:bg-slate-50"
                    }
                  >
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
                    <td className="px-3 py-2 text-xs">
                      {m.status === "sending" || m.sentAt || channels.length === 0 ? (
                        <span className={m.instanceName ? "" : "text-slate-400"} title="Número emisor">
                          {channelLabel(m.instanceName)}
                        </span>
                      ) : (
                        <select
                          value={m.instanceName ?? ""}
                          disabled={savingChanId === m.id}
                          onChange={(e) => changeChannel(m.id, e.target.value)}
                          className="text-xs border rounded px-1.5 py-1 bg-white max-w-[150px] disabled:opacity-50"
                          title="Número que enviará este mensaje"
                        >
                          <option value="">Principal</option>
                          {channels.map((c) => (
                            <option key={c.name} value={c.name}>{c.label?.trim() || c.name}</option>
                          ))}
                        </select>
                      )}
                      {m.status === "queued" && m.warming && (
                        <div className="mt-1">
                          {m.willSend ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-700" title={`Teléfono en calentamiento (tope ${m.channelCap}/día). Este mensaje entra en el cupo: lo enviará este número.`}>
                              🔥 calentando · ✅ entra
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 font-medium" title={`Teléfono en calentamiento (tope ${m.channelCap}/día) ya cubierto ese día. Al enviar, este mensaje saldrá por otro número con hueco o se aplazará a mañana.`}>
                              🔥 calentando · ⏭️ saltará (otro nº / mañana)
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-md truncate" title={m.kind === "ranking" ? (m.renderedMessage || "Imagen de posicionamiento (pie automático)") : m.renderedMessage}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`text-[9px] px-1 py-0.5 rounded font-semibold ${m.kind === "ranking" ? "bg-emerald-100 text-emerald-700" : m.kind === "voice" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                          {m.kind === "ranking" ? "IMG" : m.kind === "voice" ? "VOZ" : "TXT"}
                        </span>
                        {m.kind === "ranking" ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <span className="font-medium">Imagen de posicionamiento</span>
                            {m.renderedMessage ? <span className="text-slate-500">· {m.renderedMessage}</span> : <span className="text-slate-400">· pie automático</span>}
                          </span>
                        ) : m.kind === "voice" ? (
                          <span className="inline-flex items-center gap-1.5 text-violet-700 max-w-full">
                            <button
                              type="button"
                              onClick={() => setPlayingVoiceId(playingVoiceId === m.id ? null : m.id)}
                              title="Escuchar la nota de voz"
                              className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-violet-600 text-white text-[10px] hover:bg-violet-700 shrink-0"
                            >
                              {playingVoiceId === m.id ? "■" : "▶"}
                            </button>
                            {playingVoiceId === m.id ? (
                              <audio autoPlay controls preload="none" className="h-7 max-w-[220px]" src={`/api/v1/leads/queue/${m.id}/voice.mp3`} />
                            ) : (
                              <>
                                <span className="font-medium">Nota de voz</span>
                                {m.renderedMessage ? <span className="text-slate-500 truncate">· {m.renderedMessage}</span> : null}
                              </>
                            )}
                          </span>
                        ) : m.renderedMessage ? (
                          <span>{m.renderedMessage}</span>
                        ) : (
                          <span className="text-rose-400 italic">(sin texto)</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {editingDateId === m.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="datetime-local"
                            value={editDateVal}
                            onChange={(e) => setEditDateVal(e.target.value)}
                            className="text-xs border rounded px-1.5 py-1"
                          />
                          <button
                            onClick={() => saveEditDate(m.id)}
                            disabled={savingDateId === m.id}
                            className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                          >
                            {savingDateId === m.id ? "…" : "Guardar"}
                          </button>
                          <button
                            onClick={() => setEditingDateId(null)}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {m.scheduledAt ? new Date(m.scheduledAt).toLocaleString("es-ES") : "—"}
                          {m.status === "queued" && (
                            <button
                              onClick={() => startEditDate(m)}
                              className="text-slate-300 hover:text-indigo-600"
                              title="Editar fecha de envío"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{m.status}</td>
                    <td className="px-3 py-2 text-xs">{m.sendAttempts}{m.lastError && ` ⚠ ${m.lastError.slice(0, 40)}`}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setPreviewRow(m)}
                        className="mr-1 inline-flex items-center justify-center p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                        title="Vista previa del mensaje (texto + imagen)"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
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
                      {m.status === "failed" && (
                        <button
                          onClick={() => retryOne(m.id)}
                          disabled={sendingNowId === m.id}
                          className="mr-1 inline-flex items-center justify-center p-1.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                          title="Reintentar este mensaje fallido (vuelve a la cola)"
                        >
                          {sendingNowId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
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
      <EnqueueModal
        open={rankOpen}
        onClose={() => setRankOpen(false)}
        leadIds={rankIds}
        initialKind="ranking"
        onDone={() => { setRankOpen(false); onChanged(); }}
      />
      <Modal open={!!previewRow} onClose={() => setPreviewRow(null)} title="Vista previa del mensaje" size="md">
        {previewRow && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              📞 {previewRow.phoneNormalized} · enviar desde: <strong>{previewRow.instanceName || "Principal"}</strong>
            </div>
            {geoWarn && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠️ Las coordenadas de este lead parecen estar en <strong>{geoWarn.detectedProvince || "otra provincia"}</strong>
                {geoWarn.leadProvince ? <> y no en <strong>{geoWarn.leadProvince}</strong></> : null}. El ranking por
                cercanía (y la imagen) puede salir incorrecto — revisa/recaptura la ubicación de este lead antes de enviar.
                <div className="mt-2">
                  <button
                    onClick={fixGeo}
                    disabled={fixingGeo}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-amber-800 font-medium hover:bg-amber-100 disabled:opacity-50"
                  >
                    {fixingGeo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "📍"} Corregir ubicación (re-geocodificar)
                  </button>
                </div>
              </div>
            )}
            {/* Simulación de burbuja de WhatsApp (refleja en vivo lo que escribes) */}
            <div className="rounded-xl bg-[#e5ddd5] p-4">
              <div className="ml-auto max-w-[85%] rounded-lg bg-[#dcf8c6] shadow-sm overflow-hidden">
                {previewRow.kind === "ranking" && (
                  <img
                    src={`/api/v1/leads/queue/${previewRow.id}/ranking.png`}
                    alt="Imagen de posicionamiento"
                    className="w-full block"
                    style={{ maxHeight: 380, objectFit: "contain", background: "#fff" }}
                  />
                )}
                {previewRow.kind === "voice" && (
                  <div className="px-3 pt-2">
                    <audio controls preload="none" className="w-full" src={`/api/v1/leads/queue/${previewRow.id}/voice.mp3`}>
                      Tu navegador no soporta audio.
                    </audio>
                    <p className="text-[10px] text-slate-500 mt-1">🎙️ Nota de voz IA (se genera al pulsar play; usa tu voz de ElevenLabs).</p>
                  </div>
                )}
                <div className="px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap min-h-[1.5rem]">
                  {previewText
                    ? previewText
                    : previewRow.kind === "ranking"
                      ? "(pie automático: se genera según la posición real del lead al enviar)"
                      : "(sin texto)"}
                </div>
              </div>
            </div>

            {/* Editor del texto (solo si sigue en cola) */}
            {previewRow.status === "queued" ? (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600">
                  {previewRow.kind === "ranking" ? "Texto (pie de la imagen)" : "Texto del mensaje"}
                </label>
                <textarea
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  rows={4}
                  placeholder={previewRow.kind === "ranking" ? "Deja vacío para pie automático…" : "Texto del mensaje…"}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPreviewRow(null)} className="px-3 py-1.5 rounded-lg text-sm border bg-white hover:bg-slate-50">Cerrar</button>
                  <button
                    onClick={savePreviewText}
                    disabled={savingPreview}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {savingPreview && <Loader2 className="h-4 w-4 animate-spin" />}
                    Guardar texto
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">Este mensaje ya no está en cola; no se puede editar.</p>
            )}
            {previewRow.kind === "voice" && (
              <p className="text-[11px] text-violet-600">🎙️ Se enviará como <strong>nota de voz</strong> generada con ElevenLabs a partir de este texto (si no hay voz configurada, se envía como texto).</p>
            )}
            {previewRow.kind === "ranking" && (
              <p className="text-[11px] text-slate-400">
                La imagen se genera ahora desde Google (puede tardar unos segundos). Al enviar se recalcula con datos frescos.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============ INBOX ============

// ============ INBOX MULTI-WHATSAPP (estilo WhatsApp Web) ============

type Conversation = {
  phone: string;
  realPhone: string | null;
  isLid: boolean;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  displayName: string | null;
  note: string | null;
  priority: string; // alta | media | baja | none
  status: string; // pending | followup | resolved
  archived: boolean;
  followupAt: string | null;
  aiScore: number | null;
  aiCallNow: boolean;
  lastBody: string;
  lastAt: string;
  lastInboundAt: string | null;
  lastDirection: string;
  unread: number;
  instanceName: string | null;
  classification: string | null;
  optedOut?: boolean; // bloqueado para siempre (opt-out real)
  matchSnippet?: string | null; // fragmento del mensaje que casó con la búsqueda
  matchSource?: string | null; // "inbound" | "outbound"
};

/** Qué teléfono mostrar: el del lead vinculado, el real que mande WAHA, o un
 *  aviso si WhatsApp lo oculta (LID). Nunca el id privado feo. */
function shownPhone(c: { leadPhone?: string | null; realPhone?: string | null; isLid?: boolean; phone: string }): string {
  return displayedLeadPhone({ ...c, selectedPhone: c.phone });
}

/** Nombre legible del canal (número de WhatsApp) a partir del nombre de sesión. */
function channelLabelOf(channels: { name: string; label?: string | null }[], name: string | null | undefined): string {
  return managedChannelLabel(channels, name);
}

/** Resalta (en negrita) las apariciones de `term` dentro de `text`, sin
 *  distinguir mayúsculas. Escapa los caracteres especiales del término. */
function Highlighted({ text, term }: { text: string; term: string }) {
  const t = (term ?? "").replace(/\s+/g, " ").trim();
  if (!t) return <>{text}</>;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${esc})`, "ig"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === t.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-slate-900 rounded px-0.5">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  pending: { label: "🕘 Pendiente", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  followup: { label: "📌 Seguimiento", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  resolved: { label: "✅ Resuelto", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  not_interested: { label: "❌ No interesado", cls: "bg-rose-50 text-rose-700 border-rose-200" }
};

const PRIORITY_CHIP: Record<string, { label: string; cls: string }> = {
  alta: { label: "🔴 Alta", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  media: { label: "🟡 Media", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  baja: { label: "⚪ Baja", cls: "bg-slate-50 text-slate-600 border-slate-200" }
};

type ThreadItem = {
  id: string;
  direction: "in" | "out";
  body: string;
  at: string;
  instanceName: string | null;
  kind: "inbox" | "campaign";
  classification?: string | null;
  ack?: number | null;
};

/** Check de oro: ticks de WhatsApp del acuse de recibo de un mensaje saliente. */
function AckTicks({ ack }: { ack?: number | null }) {
  if (ack == null) return null;
  if (ack < 0) return <span title="No entregado (error)" className="text-rose-500">✗</span>;
  if (ack >= 3) return <span title="Leído" className="text-sky-500">✓✓</span>;
  if (ack === 2) return <span title="Entregado al móvil" className="text-slate-500">✓✓</span>;
  return <span title="Enviado" className="text-slate-400">✓</span>;
}

const CLASS_CHIP: Record<string, { label: string; cls: string }> = {
  interested: { label: "🔥 Interesado", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  info_request: { label: "❓ Pide info", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  objection: { label: "🤔 Objeción", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  opt_out: { label: "🚫 Baja", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  positive_no: { label: "🙂 No por ahora", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  auto_reply: { label: "🤖 Auto", cls: "bg-slate-50 text-slate-500 border-slate-200" },
  off_topic: { label: "💬 Otro tema", cls: "bg-slate-50 text-slate-500 border-slate-200" }
};

/** Bandeja de conversaciones multi-número: todas las respuestas de todos los
 *  WhatsApp en una pantalla, con hilo y caja para responder DESDE el Hub
 *  (la respuesta sale por el mismo número al que escribió el lead). */
function InboxChat({
  loading,
  diagnostics,
  initialPhone
}: {
  loading: boolean;
  diagnostics: { webhookLastHit: string | null; webhookLastEvent: string | null; webhookLastDecision?: string | null; webhookLastFrom?: string | null; webhookLastBody?: string | null; webhookLastKeys?: string | null; webhookLastMsgAt?: string | null; webhookLastMsgDecision?: string | null; webhookLastMsgEvent?: string | null; webhookLastMsgFrom?: string | null; webhookLastMsgBody?: string | null; webhookLastMsgPayloadKeys?: string | null; webhookMe?: string | null; webhookSession?: string | null };
  initialPhone?: string | null;
}) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convsLoaded, setConvsLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Deep-link: si venimos de una tarea (?phone=…), abrir esa conversación al
  // entrar. Solo una vez.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || !initialPhone) return;
    deepLinkedRef.current = true;
    setSelected(initialPhone);
  }, [initialPhone]);
  // Crear tarea desde la conversación (modal).
  const [ctOpen, setCtOpen] = useState(false);
  const [ctLoading, setCtLoading] = useState(false);
  const [ctCreating, setCtCreating] = useState(false);
  const [ctTitle, setCtTitle] = useState("");
  const [ctProjectId, setCtProjectId] = useState("");
  const [ctStatus, setCtStatus] = useState("");
  const [ctProjects, setCtProjects] = useState<{ id: string; name: string; columns: { id: string; label: string }[] }[]>([]);
  // Canales (números de WhatsApp) para mostrar con nombre legible cuál gestiona
  // cada lead. channelLabel = helper local que usa este estado.
  const [channels, setChannels] = useState<{ name: string; label?: string | null }[]>([]);
  useEffect(() => {
    fetch("/api/v1/leads/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setChannels(Array.isArray(d?.channels) ? d.channels.filter((c: any) => c?.name) : []))
      .catch(() => {});
  }, []);
  const channelLabel = (name: string | null | undefined) => channelLabelOf(channels, name);
  // Filtros y orden de la lista (clave para no ahogarse con volumen).
  const [search, setSearch] = useState("");
  // Búsqueda por CONTENIDO de mensaje (server-side). `search` se debouncea a
  // `qDebounced` para no lanzar una petición por tecla; un contador de secuencia
  // + AbortController descartan respuestas antiguas (resultados obsoletos).
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);
  const convsReqSeq = useRef(0);
  const convsAbortRef = useRef<AbortController | null>(null);
  const [fPriority, setFPriority] = useState<string>("all"); // all|alta|media|baja
  const [fClass, setFClass] = useState<string>("all"); // all|interested|info_request|objection|opt_out
  const [fUnread, setFUnread] = useState(false);
  const [fStatus, setFStatus] = useState<string>("all"); // all|pending|followup|resolved
  const [fDate, setFDate] = useState<"all" | "today" | "7d" | "30d">("all"); // por actividad reciente
  // Filtros server-side (se re-consultan al servidor, no se filtran en cliente):
  const [fAccount, setFAccount] = useState<string>("all"); // cuenta/número de WhatsApp (instanceName)
  const [accounts, setAccounts] = useState<string[]>([]); // opciones reales disponibles
  const [fExactDate, setFExactDate] = useState<string>(""); // YYYY-MM-DD (día local exacto)
  const [fBlocked, setFBlocked] = useState<"all" | "blocked" | "unblocked">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState<"hot" | "priority" | "recent" | "unread">("hot");
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [threadMeta, setThreadMeta] = useState<{
    leadName: string | null;
    leadPhone: string | null;
    realPhone: string | null;
    isLid: boolean;
    displayName: string | null;
    note: string | null;
    priority: string;
    status: string;
    archived: boolean;
    followupAt: string | null;
    leadId: string | null;
    commercialTaskId: string | null;
    commercialSentAt: string | null;
    aiScore: number | null;
    aiScoreReason: string | null;
    aiDraft: string | null;
    aiCallNow: boolean;
    aiCallScript: string | null;
    autoFollowupStep: number;
    autoFollowupOff: boolean;
    replyChannel: string | null;
    optedOut: boolean;
    conversationTask: { id: string; title: string; status: string } | null;
  }>({ leadName: null, leadPhone: null, realPhone: null, isLid: false, displayName: null, note: null, priority: "none", status: "pending", archived: false, followupAt: null, leadId: null, commercialTaskId: null, commercialSentAt: null, aiScore: null, aiScoreReason: null, aiDraft: null, aiCallNow: false, aiCallScript: null, autoFollowupStep: 0, autoFollowupOff: false, replyChannel: null, optedOut: false, conversationTask: null });
  const [noteDraft, setNoteDraft] = useState("");
  // Mientras el usuario edita la nota, el sondeo de la conversación (cada 8s) NO
  // debe sobrescribir lo que está escribiendo. Este ref marca el foco.
  const noteFocusedRef = useRef(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [commercialSending, setCommercialSending] = useState(false);
  const [commercialMessage, setCommercialMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadReqSeq = useRef(0);

  async function loadConvs() {
    const q = new URLSearchParams();
    if (fAccount !== "all") q.set("account", fAccount);
    if (fBlocked !== "all") q.set("blocked", fBlocked);
    if (fExactDate) {
      const range = localDayRangeUtc(fExactDate);
      if (range) { q.set("dateFrom", range.from); q.set("dateTo", range.to); }
    }
    // Solo se busca por texto a partir del mínimo de caracteres (el aviso al
    // usuario se muestra por debajo). Se envía el término normalizado.
    if (isSearchable(qDebounced)) q.set("q", normalizeSearch(qDebounced));
    const qs = q.toString();
    // Cancela cualquier petición anterior en vuelo y marca esta como la última.
    convsAbortRef.current?.abort();
    const ctrl = new AbortController();
    convsAbortRef.current = ctrl;
    const seq = ++convsReqSeq.current;
    try {
      const r = await fetch(`/api/v1/leads/inbox/conversations${qs ? `?${qs}` : ""}`, { signal: ctrl.signal });
      if (r.ok) {
        const d = await r.json();
        // Descarta respuestas obsoletas: solo aplica si sigue siendo la última.
        if (seq !== convsReqSeq.current) return;
        setConvs(d.items ?? []);
        if (Array.isArray(d.accounts)) setAccounts(d.accounts);
      }
    } catch {
      /* abortada o error de red: se ignora (el intervalo reintenta) */
    } finally {
      if (seq === convsReqSeq.current) setConvsLoaded(true);
    }
  }
  async function loadThread(phone: string) {
    const seq = ++threadReqSeq.current;
    const r = await fetch(`/api/v1/leads/inbox/conversation?phone=${encodeURIComponent(phone)}`);
    if (!r.ok) return;
    const d = await r.json();
    if (seq !== threadReqSeq.current) return;
    setThread(d.items ?? []);
    setThreadMeta({
      leadName: d.lead?.name ?? null,
      leadPhone: d.lead?.phone ?? null,
      realPhone: d.realPhone ?? null,
      isLid: !!d.isLid,
      displayName: d.displayName ?? null,
      note: d.note ?? null,
      priority: d.priority ?? "none",
      status: d.status ?? "pending",
      archived: !!d.archived,
      followupAt: d.followupAt ?? null,
      leadId: d.lead?.id ?? null,
      commercialTaskId: d.lead?.commercialTaskId ?? null,
      commercialSentAt: d.lead?.commercialSentAt ?? null,
      aiScore: d.aiScore ?? null,
      aiScoreReason: d.aiScoreReason ?? null,
      aiDraft: d.aiDraft ?? null,
      aiCallNow: !!d.aiCallNow,
      aiCallScript: d.aiCallScript ?? null,
      autoFollowupStep: d.autoFollowupStep ?? 0,
      autoFollowupOff: !!d.autoFollowupOff,
      replyChannel: d.replyChannel ?? null,
      optedOut: !!d.optedOut,
      conversationTask: d.conversationTask ?? null
    });
    // No pisar la nota que el usuario está escribiendo (sondeo cada 8s).
    if (!noteFocusedRef.current) setNoteDraft(d.note ?? "");
    // Al abrir, los no-leídos de esa conversación quedan vistos.
    setConvs((prev) => prev.map((c) => (c.phone === phone ? { ...c, unread: 0 } : c)));
  }

  async function sendSelectedToCommercial() {
    if (!threadMeta.leadId || threadMeta.commercialSentAt) return;
    setCommercialSending(true);
    setCommercialMessage(null);
    try {
      const r = await fetch(`/api/v1/leads/${threadMeta.leadId}/send-to-commercial`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d?.error?.message ?? `Error ${r.status}`);
      setThreadMeta((m) => ({
        ...m,
        commercialTaskId: d.taskId ?? m.commercialTaskId,
        commercialSentAt: d.sentAt ?? new Date().toISOString()
      }));
      setCommercialMessage({ ok: true, text: "Tarea creada y aviso enviado a Aitor" });
    } catch (e: any) {
      setCommercialMessage({ ok: false, text: e?.message ?? "No se pudo enviar a comercial" });
    } finally {
      setCommercialSending(false);
    }
  }

  // Carga + refresco suave (las respuestas de leads llegan en cualquier momento).
  // Se re-consulta al servidor cuando cambia un filtro server-side (cuenta,
  // bloqueado, fecha exacta) para no filtrar en cliente sobre datos incompletos.
  // Recarga inmediata al cambiar filtros/selección (sin cambios); el refresco
  // recurrente pasa a canales pausables al ocultar la pestaña (F2.6).
  useEffect(() => {
    loadConvs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fAccount, fBlocked, fExactDate, qDebounced]);
  usePollingChannel(() => loadConvs(), 12_000);
  useEffect(() => {
    if (!selected) return;
    loadThread(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  usePollingChannel(() => { if (selected) loadThread(selected); }, 8_000, !!selected);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.length, selected]);

  async function send() {
    const text = draft.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const r = await fetch("/api/v1/leads/inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected, text })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      setDraft("");
      setThread((prev) => [
        ...prev,
        { id: d.id ?? `tmp-${Date.now()}`, direction: "out", body: text, at: d.at ?? new Date().toISOString(), instanceName: d.instanceName ?? null, kind: "inbox" }
      ]);
      setConvs((prev) =>
        prev.map((c) => (c.phone === selected ? { ...c, lastBody: text, lastDirection: "out", lastAt: new Date().toISOString() } : c))
      );
    } catch (e: any) {
      setSendErr(e?.message ?? "No se pudo enviar");
    } finally {
      setSending(false);
    }
  }

  async function sendAttachment() {
    if (!attachment || !selected || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const form = new FormData();
      form.set("phone", selected);
      form.set("file", attachment);
      if (draft.trim()) form.set("caption", draft.trim());
      const r = await fetch("/api/v1/leads/inbox/reply-file", { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      setAttachment(null);
      setDraft("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setThread((prev) => [...prev, {
        id: d.id ?? `tmp-file-${Date.now()}`,
        direction: "out",
        body: d.body,
        at: d.at ?? new Date().toISOString(),
        instanceName: d.instanceName ?? null,
        kind: "inbox"
      }]);
    } catch (e: any) {
      setSendErr(e?.message ?? "No se pudo enviar el archivo");
    } finally {
      setSending(false);
    }
  }

  async function suggestReply() {
    if (!selected || suggesting) return;
    setSuggesting(true);
    setSendErr(null);
    try {
      const r = await fetch("/api/v1/leads/inbox/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      if (d.suggestion) setDraft(d.suggestion);
    } catch (e: any) {
      setSendErr(e?.message ?? "No se pudo sugerir respuesta");
    } finally {
      setSuggesting(false);
    }
  }

  const [sendingExtra, setSendingExtra] = useState<string | null>(null);
  async function sendExtra(kind: "demo" | "mockup") {
    if (!selected || sendingExtra) return;
    setSendingExtra(kind);
    setSendErr(null);
    try {
      const ep = kind === "demo" ? "/api/v1/leads/inbox/send-demo"
        : `/api/v1/leads/${threadMeta.leadId}/send-mockup`;
      const body = kind === "demo" ? JSON.stringify({ phone: selected }) : JSON.stringify({});
      const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      await loadThread(selected);
    } catch (e: any) {
      setSendErr(e?.message ?? "No se pudo enviar");
    } finally {
      setSendingExtra(null);
    }
  }

  async function saveMeta(patch: { note?: string | null; priority?: string; displayName?: string | null; status?: string; archived?: boolean; followupAt?: string | null; followupNote?: string | null; autoFollowupOff?: boolean }) {
    if (!selected) return;
    setSavingMeta(true);
    try {
      const r = await fetch("/api/v1/leads/inbox/conversation-meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected, ...patch })
      });
      if (r.ok) {
        const d = await r.json();
        setThreadMeta((m) => ({ ...m, note: d.note ?? null, priority: d.priority ?? "none", displayName: d.displayName ?? null, status: d.status ?? "pending", archived: !!d.archived, followupAt: d.followupAt ?? m.followupAt, autoFollowupOff: d.autoFollowupOff ?? m.autoFollowupOff }));
        setConvs((prev) =>
          prev.map((c) =>
            c.phone === selected
              ? { ...c, note: d.note ?? null, priority: d.priority ?? "none", displayName: d.displayName ?? null, status: d.status ?? "pending", archived: !!d.archived, followupAt: d.followupAt ?? c.followupAt }
              : c
          )
        );
        if (patch.archived === true && selected) setSelected(null);
      }
    } finally {
      setSavingMeta(false);
    }
  }

  async function blockForever() {
    if (!selected) return;
    const who = threadMeta.leadName || threadMeta.displayName || selected;
    if (
      !confirm(
        `¿Bloquear a "${who}" PARA SIEMPRE?\n\nSe cancelan sus mensajes en cola, se paran sus secuencias y su negocio queda EXCLUIDO: no se le volverá a contactar aunque reaparezca en futuras búsquedas.`
      )
    )
      return;
    setSavingMeta(true);
    try {
      const r = await fetch("/api/v1/leads/inbox/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected, leadId: threadMeta.leadId ?? undefined })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d?.message ?? d?.error?.message ?? "No se pudo bloquear.");
        return;
      }
      alert(
        `✅ Bloqueado "${d.businessName || who}".\n` +
          `· ${d.optoutPhones?.length ?? 0} teléfono(s) en opt-out\n` +
          `· ${d.canceledMessages ?? 0} mensaje(s) cancelado(s) en cola\n` +
          `· ${d.stoppedSequences ?? 0} secuencia(s) detenida(s)\n` +
          `${d.excludedLead ? "· Negocio marcado como EXCLUIDO (no reaparece en búsquedas)" : ""}`
      );
      setThreadMeta((m) => ({ ...m, optedOut: true, status: "not_interested", autoFollowupOff: true }));
      void loadThread(selected);
      void loadConvs();
    } finally {
      setSavingMeta(false);
    }
  }

  async function openCreateTask() {
    if (!selected) return;
    setCtOpen(true);
    setCtLoading(true);
    setCtProjects([]);
    setCtTitle("");
    try {
      const qs = new URLSearchParams({ phone: selected });
      if (threadMeta.leadId) qs.set("leadId", threadMeta.leadId);
      const r = await fetch(`/api/v1/leads/inbox/create-task?${qs.toString()}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d?.message ?? d?.error?.message ?? "No se pudo preparar la tarea.");
        setCtOpen(false);
        return;
      }
      setCtProjects(d.projects ?? []);
      setCtTitle(d.suggestedTitle ?? "");
      setCtProjectId(d.defaultProjectId ?? d.projects?.[0]?.id ?? "");
      setCtStatus(d.defaultStatus ?? "");
    } catch (e: any) {
      alert(e?.message ?? "Error de red");
      setCtOpen(false);
    } finally {
      setCtLoading(false);
    }
  }
  async function submitCreateTask() {
    if (!selected || !ctTitle.trim()) return;
    setCtCreating(true);
    try {
      const r = await fetch("/api/v1/leads/inbox/create-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: selected,
          leadId: threadMeta.leadId ?? undefined,
          projectId: ctProjectId || undefined,
          status: ctStatus || undefined,
          title: ctTitle.trim()
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d?.message ?? d?.error?.message ?? "No se pudo crear la tarea.");
        return;
      }
      setCtOpen(false);
      if (d.task?.id) {
        setThreadMeta((m) => ({
          ...m,
          conversationTask: { id: d.task.id, title: d.task.title, status: d.task.status }
        }));
      }
      if (d.taskUrl && confirm("✅ Tarea creada. ¿Abrirla ahora?")) {
        window.open(d.taskUrl, "_blank");
      }
    } catch (e: any) {
      alert(e?.message ?? "Error de red");
    } finally {
      setCtCreating(false);
    }
  }

  // Columnas del proyecto seleccionado en el modal.
  const ctColumns = ctProjects.find((p) => p.id === ctProjectId)?.columns ?? [];

  if (loading && !convsLoaded) return <Loading />;

  // ¿Hay una consulta SERVER-SIDE activa (búsqueda por texto / cuenta / fecha /
  // bloqueado)? Si la hay, un resultado vacío significa "sin coincidencias", NO
  // "el webhook no recibe". Antes, cualquier búsqueda sin resultados mostraba el
  // panel de diagnóstico de WAHA a pantalla completa y OCULTABA el propio
  // buscador (incidencia de producción): el usuario no podía ni ver su búsqueda.
  const serverQueryActive = fAccount !== "all" || fBlocked !== "all" || !!fExactDate || isSearchable(qDebounced);
  if (convsLoaded && convs.length === 0 && !serverQueryActive) {
    // Inbox genuinamente vacío: reutiliza el diagnóstico del webhook (clave para
    // detectar que WAHA no está reenviando los mensajes entrantes).
    return <InboxList loading={false} items={[]} diagnostics={diagnostics} />;
  }

  // Fallback sintético cuando el teléfono seleccionado no está en la lista
  // (p. ej. deep-link desde una tarea, o filtrado): así el panel de la
  // conversación se renderiza igual y loadThread rellena los datos.
  const sel =
    convs.find((c) => c.phone === selected) ??
    (selected ? ({ phone: selected } as unknown as Conversation) : null);
  const selectedHeader = sel
    ? conversationHeader({
        ...threadMeta,
        selectedPhone: sel.phone,
      })
    : null;

  // Aplica búsqueda + filtros + orden a la lista (no toca el servidor).
  const PR_RANK: Record<string, number> = { alta: 0, media: 1, baja: 2, none: 3 };
  const visibleConvs = convs
    .filter((c) => {
      if (c.archived !== showArchived) return false; // por defecto oculta archivadas
      if (fPriority !== "all" && c.priority !== fPriority) return false;
      if (fStatus !== "all" && c.status !== fStatus) return false;
      if (fClass !== "all" && c.classification !== fClass) return false;
      if (fUnread && c.unread === 0) return false;
      if (fDate !== "all") {
        // Filtra por el último mensaje RECIBIDO del lead (no por tus respuestas).
        const days = fDate === "today" ? 1 : fDate === "7d" ? 7 : 30;
        const cutoff = fDate === "today"
          ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
          : Date.now() - days * 86400000;
        const inAt = c.lastInboundAt ? new Date(c.lastInboundAt).getTime() : null;
        if (inAt === null || inAt < cutoff) return false;
      }
      // La búsqueda por texto es SERVER-SIDE (busca en TODOS los mensajes,
      // entrantes y salientes, no solo en los cargados). Aquí no se filtra por
      // `search` para no ocultar coincidencias en mensajes antiguos.
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "hot") return (b.aiScore ?? -1) - (a.aiScore ?? -1) || new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
      // "Recientes" = por el último mensaje RECIBIDO del lead (quien acaba de
      // escribirte sube arriba aunque no le hayas contestado). Sin entrante → al fondo.
      if (sortBy === "recent") return new Date(b.lastInboundAt ?? 0).getTime() - new Date(a.lastInboundAt ?? 0).getTime();
      if (sortBy === "unread") return b.unread - a.unread || new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
      // priority (por defecto): alta primero, luego reciente
      return (PR_RANK[a.priority] ?? 3) - (PR_RANK[b.priority] ?? 3) || new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    });
  const activeFilters = (fPriority !== "all" ? 1 : 0) + (fStatus !== "all" ? 1 : 0) + (fClass !== "all" ? 1 : 0) + (fUnread ? 1 : 0) + (fDate !== "all" ? 1 : 0) + (isSearchable(search) ? 1 : 0) + (fAccount !== "all" ? 1 : 0) + (fExactDate ? 1 : 0) + (fBlocked !== "all" ? 1 : 0);

  return (
    <div className="bg-white rounded-xl border overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr]" style={{ height: "72vh" }}>
      {ctOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !ctCreating && setCtOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">＋ Crear tarea del lead</h3>
              <button onClick={() => setCtOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            {ctLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Generando título con IA…
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-600">Título (generado por IA, editable)</span>
                  <textarea
                    value={ctTitle}
                    onChange={(e) => setCtTitle(e.target.value)}
                    rows={2}
                    className="mt-1 w-full text-sm border rounded-md px-2 py-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] font-medium text-slate-600">Proyecto</span>
                    <select
                      value={ctProjectId}
                      onChange={(e) => {
                        setCtProjectId(e.target.value);
                        const cols = ctProjects.find((p) => p.id === e.target.value)?.columns ?? [];
                        // Al cambiar de proyecto, intenta mantener "REUNIONES…" si existe.
                        const reu = cols.find((c) => c.label.toUpperCase().includes("REUNIONES"));
                        setCtStatus(reu?.id ?? cols[0]?.id ?? "");
                      }}
                      className="mt-1 w-full text-sm border rounded-md px-2 py-1.5 bg-white"
                    >
                      {ctProjects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-slate-600">Columna</span>
                    <select
                      value={ctStatus}
                      onChange={(e) => setCtStatus(e.target.value)}
                      className="mt-1 w-full text-sm border rounded-md px-2 py-1.5 bg-white"
                    >
                      {ctColumns.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-[11px] text-slate-400">
                  La tarea se marcará en verde (🟢 Lead Pro) y tendrá un botón para volver a esta conversación.
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setCtOpen(false)} className="px-3 py-1.5 text-xs rounded-md border hover:bg-slate-50">Cancelar</button>
                  <button
                    onClick={() => void submitCreateTask()}
                    disabled={ctCreating || !ctTitle.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {ctCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "＋"} Crear tarea
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Lista de conversaciones */}
      <div className={`border-r overflow-y-auto ${selected ? "hidden md:block" : ""}`}>
        {/* Barra de búsqueda + filtros + orden */}
        <div className="sticky top-0 z-10 bg-white border-b p-2 space-y-1.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔎 Buscar por nombre, teléfono o texto de un mensaje…"
            className="w-full text-xs px-2.5 py-1.5 rounded-md border bg-slate-50"
          />
          {search.trim().length > 0 && !isSearchable(search) && (
            <p className="text-[10px] text-amber-600 -mt-0.5">
              Escribe al menos {MIN_SEARCH_CHARS} caracteres para buscar dentro de los mensajes.
            </p>
          )}
          {isSearchable(search) && search !== qDebounced && (
            <p className="text-[10px] text-slate-400 -mt-0.5">Buscando…</p>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            {/* Prioridad */}
            {([["all", "Todas"], ["alta", "🔴"], ["media", "🟡"], ["baja", "⚪"]] as const).map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => setFPriority(v)}
                className={`text-[11px] px-1.5 py-0.5 rounded border ${fPriority === v ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
              >
                {lbl}
              </button>
            ))}
            <span className="w-px h-4 bg-slate-200 mx-0.5" />
            <button
              onClick={() => setFUnread((v) => !v)}
              className={`text-[11px] px-1.5 py-0.5 rounded border ${fUnread ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
            >
              ● No leídos
            </button>
          </div>
          {/* Filtro por fecha (actividad reciente). Combínalo con orden "Recientes". */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-slate-400">📅</span>
            {([["all", "Todo"], ["today", "Hoy"], ["7d", "7 días"], ["30d", "30 días"]] as const).map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => {
                  setFDate(v);
                  // Los accesos rápidos y la fecha exacta son excluyentes.
                  if (v !== "all") { setSortBy("recent"); setFExactDate(""); }
                }}
                className={`text-[11px] px-1.5 py-0.5 rounded border ${fDate === v ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
              >
                {lbl}
              </button>
            ))}
            {/* Fecha EXACTA (día local; server-side, sin errores de huso). */}
            <input
              type="date"
              value={fExactDate}
              onChange={(e) => {
                setFExactDate(e.target.value);
                // Excluyente con los accesos rápidos.
                if (e.target.value) { setFDate("all"); setSortBy("recent"); }
              }}
              className={`text-[11px] px-1.5 py-0.5 rounded border ${fExactDate ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200"}`}
              title="Filtrar por un día exacto"
            />
            {fExactDate && (
              <button
                onClick={() => setFExactDate("")}
                className="text-[11px] px-1.5 py-0.5 rounded border bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                title="Quitar la fecha exacta"
              >
                ✕
              </button>
            )}
          </div>
          {/* Cuenta de WhatsApp que gestionó la conversación (opciones reales) + Bloqueados */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <select
              value={fAccount}
              onChange={(e) => setFAccount(e.target.value)}
              className="text-[11px] px-1.5 py-1 rounded border bg-white"
              title="Filtrar por la cuenta/número de WhatsApp que gestionó la conversación"
            >
              <option value="all">📱 Todas las cuentas</option>
              {accounts.map((a) => (
                <option key={a} value={a}>{a === "__default__" ? "Principal (default)" : channelLabel(a)}</option>
              ))}
            </select>
            <span className="w-px h-4 bg-slate-200 mx-0.5" />
            {([["all", "Todos"], ["blocked", "🚫 Bloqueados"], ["unblocked", "No bloqueados"]] as const).map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => setFBlocked(v)}
                className={`text-[11px] px-1.5 py-0.5 rounded border ${fBlocked === v ? "bg-rose-600 text-white border-rose-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
                title="Mostrar según el estado real de 'Bloquear para siempre'"
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={fClass}
              onChange={(e) => setFClass(e.target.value)}
              className="flex-1 text-[11px] px-1.5 py-1 rounded border bg-white"
            >
              <option value="all">Todas las etiquetas IA</option>
              <option value="interested">🔥 Interesado</option>
              <option value="info_request">❓ Pide info</option>
              <option value="objection">🤔 Objeción</option>
              <option value="positive_no">🙂 No por ahora</option>
              <option value="opt_out">🚫 Baja</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-[11px] px-1.5 py-1 rounded border bg-white"
              title="Ordenar"
            >
              <option value="hot">🔥 Más calientes (IA)</option>
              <option value="priority">↕ Prioridad</option>
              <option value="recent">↕ Recientes (te escribió)</option>
              <option value="unread">↕ No leídos</option>
            </select>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {([["all", "Estado"], ["pending", "🕘"], ["followup", "📌"], ["resolved", "✅"], ["not_interested", "❌"]] as const).map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => setFStatus(v)}
                className={`text-[11px] px-1.5 py-0.5 rounded border ${fStatus === v ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
              >
                {lbl}
              </button>
            ))}
            <span className="w-px h-4 bg-slate-200 mx-0.5" />
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`text-[11px] px-1.5 py-0.5 rounded border ${showArchived ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
            >
              🗄️ {showArchived ? "Viendo archivadas" : "Archivadas"}
            </button>
          </div>
          {activeFilters > 0 && (
            <button
              onClick={() => { setSearch(""); setFPriority("all"); setFClass("all"); setFUnread(false); setFStatus("all"); setFDate("all"); setFAccount("all"); setFExactDate(""); setFBlocked("all"); }}
              className="text-[11px] text-rose-600 hover:underline"
            >
              ✕ Quitar filtros ({visibleConvs.length} de {convs.length})
            </button>
          )}
          {/* Difusión: envía un mensaje al SEGMENTO actual (los filtros de
              clasificación/estado/prioridad activos), espaciado anti-baneo. */}
          <button
            onClick={() => setShowBroadcast(true)}
            className="w-full text-[11px] font-medium px-2 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            title="Enviar un mensaje a varias conversaciones a la vez (espaciado para no quemar el número)"
          >
            📣 Difusión a este segmento
          </button>
        </div>
        {visibleConvs.length === 0 && (
          <div className="p-4 text-xs text-slate-400 text-center">
            {isSearchable(qDebounced)
              ? <>Ninguna conversación contiene «{qDebounced.trim()}» en sus mensajes{serverQueryActive ? " con los filtros actuales" : ""}.</>
              : "Ninguna conversación con esos filtros."}
          </div>
        )}
        {visibleConvs.map((c) => {
          const chip = c.classification ? CLASS_CHIP[c.classification] : null;
          // Color de TODA la tarjeta según la prioridad (alta=rojo, media=ámbar,
          // baja=gris) para ver de un vistazo a quién atender. Borde izquierdo
          // grueso + fondo tenue; la seleccionada se intensifica.
          const prCard: Record<string, { base: string; sel: string }> = {
            alta: { base: "border-l-4 border-l-rose-500 bg-rose-50/60", sel: "bg-rose-100" },
            media: { base: "border-l-4 border-l-amber-500 bg-amber-50/60", sel: "bg-amber-100" },
            baja: { base: "border-l-4 border-l-slate-400 bg-slate-50", sel: "bg-slate-100" },
            none: { base: "", sel: "bg-brand-50" }
          };
          const pc = prCard[c.priority] ?? prCard.none;
          // "No interesado": tarjeta apagada (gris + tenue) que prevalece sobre
          // el color de prioridad, para distinguir de un vistazo a los descartados.
          const notInterested = c.status === "not_interested";
          const selectedCls = notInterested
            ? selected === c.phone ? "bg-rose-100/70 opacity-90" : "bg-slate-50 opacity-60"
            : selected === c.phone ? pc.sel : pc.base;
          const listTitle = conversationListTitle({
            ...c,
            selectedPhone: c.phone,
          });
          return (
            <button
              key={c.phone}
              onClick={() => {
                threadReqSeq.current++;
                setThread([]);
                setThreadMeta((m) => ({ ...m, conversationTask: null }));
                setCommercialMessage(null);
                setSelected(c.phone);
              }}
              className={`w-full text-left px-3 py-2.5 border-b hover:brightness-95 transition ${notInterested ? "border-l-4 border-l-rose-400 " : ""}${selectedCls}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold truncate flex items-center gap-1 ${notInterested ? "text-rose-400 line-through" : "text-slate-800"}`}>
                  {notInterested && <span className="no-underline" title="No interesado">❌</span>}
                  {c.optedOut && <span className="no-underline" title="Bloqueado para siempre">🚫</span>}
                  {isSearchable(qDebounced)
                    ? <Highlighted text={listTitle} term={qDebounced} />
                    : listTitle}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {c.aiCallNow && (
                    <span className="text-[10px] font-bold px-1 rounded bg-rose-600 text-white animate-pulse" title="Momento de comprar: llámale ya">
                      📞 YA
                    </span>
                  )}
                  {c.aiScore != null && (
                    <span
                      className={`text-[10px] font-bold px-1 rounded ${c.aiScore >= 70 ? "bg-rose-100 text-rose-700" : c.aiScore >= 40 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}
                      title="Probabilidad de cierre (IA)"
                    >
                      {c.aiScore >= 70 ? "🔥" : ""}{c.aiScore}
                    </span>
                  )}
                  <span className="flex flex-col items-end leading-tight text-[10px] text-slate-400">
                    <span>
                      {c.followupAt ? "🔔 " : ""}{new Date(c.lastAt).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })}
                    </span>
                    {c.lastInboundAt && (
                      <span className="text-slate-500" title="Hora del último mensaje recibido">
                        🕐 {new Date(c.lastInboundAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </span>
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-400 truncate">📞 {shownPhone(c)}</div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-xs text-slate-500 truncate">
                  {c.lastDirection === "out" ? "Tú: " : ""}
                  {c.lastBody}
                </span>
                {c.unread > 0 && (
                  <span className="shrink-0 bg-emerald-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                    {c.unread}
                  </span>
                )}
              </div>
              {c.matchSnippet && (
                <div className="mt-1 text-[11px] text-slate-600 bg-yellow-50 border border-yellow-200 rounded px-1.5 py-1 leading-snug">
                  <span className="text-slate-400">{c.matchSource === "outbound" ? "🔎 en tu mensaje: " : "🔎 en un mensaje: "}</span>
                  <Highlighted text={c.matchSnippet} term={qDebounced} />
                </div>
              )}
              {c.note && (
                <div className="mt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 leading-snug">
                  📝 {c.note}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {/* La prioridad ya se ve por el color del cuadro; aquí solo la
                    clasificación IA y el número. */}
                {c.status && c.status !== "pending" && STATUS_CHIP[c.status] && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_CHIP[c.status].cls}`}>{STATUS_CHIP[c.status].label}</span>
                )}
                {chip && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chip.cls}`}>{chip.label}</span>}
                {/* Número de WhatsApp que gestiona este lead (canal de respuesta =
                    el del último entrante). Siempre visible para saber desde qué
                    teléfono se habla con cada lead cuando hay varios. */}
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200"
                  title="Número de WhatsApp con el que se gestiona este lead"
                >
                  📱 {c.instanceName ? channelLabel(c.instanceName) : "Principal"}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Hilo */}
      <div className={`flex flex-col min-h-0 ${selected ? "" : "hidden md:flex"}`}>
        {!sel ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            Elige una conversación para verla y responder
          </div>
        ) : (
          <>
            <div className="px-4 py-2.5 border-b bg-slate-50 space-y-1.5">
              <div className="flex items-center gap-2">
                <button onClick={() => setSelected(null)} className="md:hidden text-slate-500 text-sm">‹</button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-800 truncate">
                      {selectedHeader?.titleIsPhone ? "📞 " : ""}{selectedHeader?.title}
                    </span>
                    <button
                      onClick={() => {
                        const cur = threadMeta.displayName ?? "";
                        const next = window.prompt("Nombre para esta conversación (quién es):", cur);
                        if (next !== null) void saveMeta({ displayName: next });
                      }}
                      title="Poner/editar nombre del contacto"
                      className="text-[11px] text-slate-400 hover:text-brand-600 shrink-0"
                    >
                      ✏️
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    · 📱 gestionado por: {channelLabel(threadMeta.replyChannel)}
                  </div>
                </div>
                {/* Prioridad: a quién atender antes */}
                <div className="flex items-center gap-1 shrink-0">
                  {(["alta", "media", "baja"] as const).map((pr) => (
                    <button
                      key={pr}
                      onClick={() => void saveMeta({ priority: threadMeta.priority === pr ? "none" : pr })}
                      disabled={savingMeta}
                      title={`Prioridad ${pr}`}
                      className={`text-[11px] px-2 py-1 rounded-md border font-semibold disabled:opacity-50 ${
                        threadMeta.priority === pr
                          ? PRIORITY_CHIP[pr].cls + " ring-1 ring-current"
                          : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {pr === "alta" ? "🔴" : pr === "media" ? "🟡" : "⚪"} {pr}
                    </button>
                  ))}
                </div>
              </div>
              {/* Estado + archivar */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(["pending", "followup", "resolved", "not_interested"] as const).map((st) => (
                  <button
                    key={st}
                    // "No interesado" además apaga el auto-seguimiento para no
                    // seguir escribiendo a quien ya dijo que no.
                    onClick={() => void saveMeta(st === "not_interested" ? { status: st, autoFollowupOff: true } : { status: st })}
                    disabled={savingMeta}
                    className={`text-[11px] px-2 py-0.5 rounded-md border font-medium disabled:opacity-50 ${
                      threadMeta.status === st
                        ? STATUS_CHIP[st].cls + " ring-1 ring-current"
                        : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {STATUS_CHIP[st].label}
                  </button>
                ))}
                <span className="flex-1" />
                {threadMeta.leadId && (
                  threadMeta.commercialSentAt ? (
                    <a
                      href={threadMeta.commercialTaskId ? `/tareas?task=${threadMeta.commercialTaskId}` : "/tareas"}
                      className="text-[11px] px-2 py-0.5 rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 font-semibold"
                      title="Lead enviado a AITOR (COMERCIAL) · LEADS GMB"
                    >
                      ✓ Enviado a comercial
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void sendSelectedToCommercial()}
                      disabled={commercialSending}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 font-semibold disabled:opacity-50"
                      title="Crear tarea en AITOR (COMERCIAL) · LEADS GMB y avisar por WhatsApp"
                    >
                      {commercialSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListChecks className="h-3 w-3" />}
                      {threadMeta.commercialTaskId ? "Reintentar aviso" : "Crear tarea comercial"}
                    </button>
                  )
                )}
                <button
                  onClick={() => threadMeta.conversationTask
                    ? window.open(`/tareas?task=${threadMeta.conversationTask.id}`, "_blank")
                    : void openCreateTask()}
                  disabled={savingMeta}
                  className="text-[11px] px-2 py-0.5 rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 font-medium disabled:opacity-50"
                  title={threadMeta.conversationTask
                    ? `Tarea ya creada: ${threadMeta.conversationTask.title}. Pulsa para abrirla.`
                    : "Crear una tarea sobre este lead (proyecto y columna por defecto: NEGOCIO VIVO GENERAL · REUNIONES Y LLAMADAS). La IA genera el título con el teléfono."}
                >
                  {threadMeta.conversationTask ? "✅ Tarea creada" : "＋ Crear tarea"}
                </button>
                <button
                  onClick={() => void blockForever()}
                  disabled={savingMeta || threadMeta.optedOut}
                  className="text-[11px] px-2 py-0.5 rounded-md border bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 font-medium disabled:opacity-50"
                  title={
                    threadMeta.optedOut
                      ? "Ya está bloqueado (opt-out)"
                      : "Bloquear PARA SIEMPRE: cancela su cola, para secuencias y excluye el negocio de futuras búsquedas"
                  }
                >
                  {threadMeta.optedOut ? "🚫 Bloqueado" : "🚫 Bloquear para siempre"}
                </button>
                <button
                  onClick={() => void saveMeta({ archived: !threadMeta.archived })}
                  disabled={savingMeta}
                  className="text-[11px] px-2 py-0.5 rounded-md border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                  title={threadMeta.archived ? "Sacar del archivo" : "Archivar (sale de la bandeja)"}
                >
                  {threadMeta.archived ? "📤 Desarchivar" : "🗄️ Archivar"}
                </button>
                {commercialMessage && (
                  <span className={`text-[10px] ${commercialMessage.ok ? "text-emerald-700" : "text-rose-600"}`}>
                    {commercialMessage.text}
                  </span>
                )}
              </div>
              {/* Nota de la conversación */}
              <div className="flex items-center gap-2">
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onFocus={() => { noteFocusedRef.current = true; }}
                  onBlur={() => {
                    noteFocusedRef.current = false;
                    if (noteDraft !== (threadMeta.note ?? "")) void saveMeta({ note: noteDraft });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="📝 Nota: quién es, qué quiere, cuándo seguir…"
                  className="flex-1 text-[12px] px-2 py-1 rounded-md border bg-white"
                />
                {savingMeta && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
              </div>
              {/* Recordatorio de seguimiento + acciones rápidas */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-500">⏰</span>
                {([["2h", 2 / 24], ["Mañana", 1], ["2 días", 2], ["1 sem", 7]] as const).map(([lbl, days]) => (
                  <button
                    key={lbl}
                    onClick={() => {
                      const d = new Date(Date.now() + (days as number) * 86400000);
                      void saveMeta({ followupAt: d.toISOString() });
                    }}
                    disabled={savingMeta}
                    className="text-[11px] px-2 py-0.5 rounded-md border bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                    title="Ponme un recordatorio para seguir con este lead"
                  >
                    {lbl}
                  </button>
                ))}
                {threadMeta.followupAt && (
                  <span className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                    🔔 {new Date(threadMeta.followupAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    <button onClick={() => void saveMeta({ followupAt: null })} className="ml-1 text-rose-500">✕</button>
                  </span>
                )}
                {threadMeta.leadId && (
                  <>
                    <span className="flex-1" />
                    <button
                      onClick={() => void sendExtra("demo")}
                      disabled={!!sendingExtra}
                      className="text-[11px] px-2 py-0.5 rounded-md border border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100 disabled:opacity-50"
                    >
                      {sendingExtra === "demo" ? "…" : "🔗 Enviar demo Bubui"}
                    </button>
                    <button
                      onClick={() => void sendExtra("mockup")}
                      disabled={!!sendingExtra}
                      className="text-[11px] px-2 py-0.5 rounded-md border bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {sendingExtra === "mockup" ? "…" : "🖼️ Enviar mockup"}
                    </button>
                  </>
                )}
              </div>
              {/* Momento de comprar: alerta + guion de cierre por teléfono */}
              {threadMeta.aiCallNow && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[12px] text-rose-700">📞 Momento de comprar — llámale ya</strong>
                    {(threadMeta.leadPhone || threadMeta.realPhone) && (
                      <a
                        href={`tel:${threadMeta.leadPhone || threadMeta.realPhone}`}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 shrink-0"
                      >
                        📞 Llamar {threadMeta.leadPhone || threadMeta.realPhone}
                      </a>
                    )}
                  </div>
                  {threadMeta.aiCallScript && (
                    <div className="mt-1.5 text-[11px] text-slate-700 whitespace-pre-wrap leading-snug border-t border-rose-200 pt-1.5">
                      <span className="text-rose-600 font-medium">Guion: </span>{threadMeta.aiCallScript}
                    </div>
                  )}
                </div>
              )}
              {/* Auto-piloto de seguimiento por conversación */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => void saveMeta({ autoFollowupOff: !threadMeta.autoFollowupOff })}
                  disabled={savingMeta}
                  className={`text-[11px] px-2 py-0.5 rounded-md border font-medium disabled:opacity-50 ${
                    threadMeta.autoFollowupOff
                      ? "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
                      : "bg-indigo-50 text-indigo-700 border-indigo-200"
                  }`}
                  title="Si el lead se enfría, la IA le manda follow-ups solos (24h, 72h, 7d). Requiere activar el auto-piloto en Ajustes."
                >
                  🤖 Auto-seguimiento {threadMeta.autoFollowupOff ? "OFF" : "ON"}
                </button>
                {threadMeta.autoFollowupStep > 0 && (
                  <span className="text-[10px] text-slate-400">· {threadMeta.autoFollowupStep}/3 toques enviados</span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-[#f6f4f0]">
              {thread.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[78%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap shadow-sm ${
                      m.direction === "out" ? "bg-emerald-100 text-slate-800" : "bg-white text-slate-800"
                    }`}
                  >
                    {m.kind === "campaign" && (
                      <div className="text-[10px] text-slate-400 mb-0.5">📣 campaña</div>
                    )}
                    {m.direction === "out" && m.kind === "inbox" && (
                      <div className="text-[10px] text-emerald-700 mb-0.5">
                        📱 enviado desde {m.instanceName ? channelLabel(m.instanceName) : "Principal"}
                      </div>
                    )}
                    {m.body}
                    <div className="text-[10px] text-slate-400 text-right mt-1 flex items-center justify-end gap-1">
                      {new Date(m.at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {m.direction === "out" && <AckTicks ack={m.ack} />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            {threadMeta.optedOut && (
              <div className="px-4 py-1.5 text-[11px] bg-rose-50 text-rose-700 border-t border-rose-200">
                ⚠️ Este teléfono pidió no recibir mensajes (opt-out). Responde solo si él retomó la conversación.
              </div>
            )}
            <div className="border-t p-3 bg-white">
              {sendErr && <div className="text-xs text-rose-600 mb-1.5">✗ {sendErr}</div>}
              {threadMeta.aiDraft && draft.trim() === "" && (
                <div className="mb-2 rounded-lg border border-violet-200 bg-violet-50 p-2 text-[12px]">
                  <div className="text-violet-700 font-semibold mb-1">
                    ✨ Borrador IA listo{threadMeta.aiScore != null ? ` · ${threadMeta.aiScore}/100 de cierre` : ""}
                  </div>
                  <div className="text-slate-700 whitespace-pre-wrap">{threadMeta.aiDraft}</div>
                  <button
                    onClick={() => setDraft(threadMeta.aiDraft ?? "")}
                    className="mt-1.5 text-[11px] px-2 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700"
                  >
                    Usar este borrador
                  </button>
                </div>
              )}
              {attachment && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-slate-700">
                  <span className="truncate">📎 {attachment.name} · {(attachment.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button type="button" onClick={() => setAttachment(null)} className="font-semibold text-rose-600">Quitar</button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="mb-0.5 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-lg hover:bg-slate-50 disabled:opacity-50"
                  title="Adjuntar presupuesto o documento (máx. 20 MB)"
                >
                  📎
                </button>
                <div className="flex-1">
                  <button
                    onClick={() => void suggestReply()}
                    disabled={suggesting}
                    className="mb-1 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                    title="Que la IA proponga la respuesta según el hilo y el lead"
                  >
                    {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : "✨"} Sugerir respuesta IA
                  </button>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={2}
                    placeholder="Escribe tu respuesta… (Enter para enviar, Shift+Enter salto de línea)"
                    className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
                  />
                </div>
                <button
                  onClick={() => void (attachment ? sendAttachment() : send())}
                  disabled={sending || (!draft.trim() && !attachment)}
                  className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {attachment ? "Enviar archivo" : "Enviar"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {showBroadcast && (
        <BroadcastModal
          onClose={() => setShowBroadcast(false)}
          onSent={() => { setShowBroadcast(false); loadConvs(); }}
          segment={{
            classifications: fClass !== "all" ? [fClass] : undefined,
            statuses: fStatus !== "all" ? [fStatus] : undefined,
            priorities: fPriority !== "all" ? [fPriority] : undefined,
            includeArchived: showArchived
          }}
        />
      )}
    </div>
  );
}

/**
 * Difusión segmentada: escribe un mensaje y se envía a todas las conversaciones
 * del segmento (los filtros activos), ESPACIADO para no quemar el número.
 * Muestra previsualización de a cuántos llegará y las últimas difusiones.
 */
function BroadcastModal({
  onClose,
  onSent,
  segment
}: {
  onClose: () => void;
  onSent: () => void;
  segment: { classifications?: string[]; statuses?: string[]; priorities?: string[]; includeArchived?: boolean };
}) {
  const [text, setText] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ total: number; lastAt: string | null } | null>(null);
  const [history, setHistory] = useState<{ id: string; body: string; total: number; sentCount: number; failedCount: number; pending: number; status: string; createdAt: string }[]>([]);

  async function loadPreview() {
    try {
      const r = await fetch("/api/v1/leads/inbox/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true, segment })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setCount(d.count ?? 0);
    } catch {}
  }
  async function loadHistory() {
    try {
      const r = await fetch("/api/v1/leads/inbox/broadcast");
      if (r.ok) setHistory((await r.json()).items ?? []);
    } catch {}
  }
  useEffect(() => { loadPreview(); loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setErr(null);
    try {
      const r = await fetch("/api/v1/leads/inbox/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body, segment })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      setDone({ total: d.total ?? 0, lastAt: d.lastAt ?? null });
      setText("");
      loadHistory();
      onSent();
    } catch (e: any) {
      setErr(e?.message ?? "No se pudo enviar la difusión.");
    } finally {
      setSending(false);
    }
  }

  const segLabels: string[] = [];
  if (segment.classifications?.length) segLabels.push(`etiqueta: ${segment.classifications.join(", ")}`);
  if (segment.statuses?.length) segLabels.push(`estado: ${segment.statuses.join(", ")}`);
  if (segment.priorities?.length) segLabels.push(`prioridad: ${segment.priorities.join(", ")}`);
  if (segment.includeArchived) segLabels.push("incluye archivadas");

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl border shadow-xl w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <strong className="text-sm">📣 Difusión segmentada</strong>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-slate-600 bg-slate-50 border rounded-lg p-2.5">
            Se enviará a <strong>{count == null ? "…" : count}</strong> conversación{count === 1 ? "" : "es"}
            {segLabels.length > 0 ? <> del segmento <span className="text-slate-500">({segLabels.join(" · ")})</span></> : <> (todas las conversaciones activas)</>}.
            <div className="mt-1 text-[11px] text-slate-500">
              Los envíos van <strong>espaciados automáticamente</strong> (anti-baneo): respetan tu ventana horaria, la
              cadencia mínima y el tope por hora. No se enviará a quien pidió la baja.
            </div>
          </div>

          {done ? (
            <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">
              ✅ Difusión programada a <strong>{done.total}</strong> contactos.
              {done.lastAt && <> El último saldrá aprox. el <strong>{new Date(done.lastAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</strong>.</>}
              <div className="mt-1 text-[11px]">Se irán enviando solos en segundo plano. Puedes cerrar esta ventana.</div>
            </div>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder="Escribe el mensaje… Usa {{nombre}} para personalizar con el nombre del contacto."
                className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
              />
              <div className="text-[11px] text-slate-400">
                💡 Cada mensaje se envía al chat existente del contacto. Tip: <code className="bg-slate-100 px-1 rounded">{"{{nombre}}"}</code> se sustituye por su nombre.
              </div>
              {err && <div className="text-xs text-rose-600">{err}</div>}
              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose} className="px-3 py-2 rounded-lg border text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button
                  onClick={() => void send()}
                  disabled={sending || !text.trim() || (count ?? 0) === 0}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Enviar a {count ?? 0}
                </button>
              </div>
            </>
          )}

          {history.length > 0 && (
            <div className="pt-2 border-t">
              <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Últimas difusiones</div>
              <div className="space-y-1.5">
                {history.map((h) => (
                  <div key={h.id} className="text-[11px] text-slate-600 bg-slate-50 border rounded p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{h.body}</span>
                      <span className={`shrink-0 px-1.5 rounded ${h.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {h.status === "done" ? "✓ Enviada" : "⏳ Enviando"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-slate-400">
                      {h.sentCount}/{h.total} enviados{h.failedCount > 0 ? ` · ${h.failedCount} fallidos` : ""}{h.pending > 0 ? ` · ${h.pending} en cola` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Configura el webhook entrante (WAHA o Evolution) sin pasar por Ajustes.
 *  Detecta el proveedor por los settings y llama al endpoint correcto. */
function InlineWebhookButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const sr = await fetch("/api/v1/leads/settings");
      const s = sr.ok ? await sr.json() : {};
      const provider = s?.whatsappProvider === "evolution" ? "evolution" : "waha";
      const ep = provider === "evolution" ? "/api/v1/leads/evolution-webhook-setup" : "/api/v1/leads/waha-webhook-setup";
      const r = await fetch(ep, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
      setResult({ ok: true, msg: `✓ Webhook configurado (${d.url ?? provider}). Ahora las respuestas llegarán al Inbox.` });
    } catch (e: any) {
      setResult({ ok: false, msg: `✗ ${e?.message ?? "No se pudo configurar"}` });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Configurar webhook ahora
      </button>
      {result && <div className={result.ok ? "text-emerald-700" : "text-rose-700"}>{result.msg}</div>}
    </div>
  );
}

function InboxList({
  loading,
  items,
  diagnostics
}: {
  loading: boolean;
  items: InboxRow[];
  diagnostics: { webhookLastHit: string | null; webhookLastEvent: string | null; webhookLastDecision?: string | null; webhookLastFrom?: string | null; webhookLastBody?: string | null; webhookLastKeys?: string | null; webhookLastMsgAt?: string | null; webhookLastMsgDecision?: string | null; webhookLastMsgEvent?: string | null; webhookLastMsgFrom?: string | null; webhookLastMsgBody?: string | null; webhookLastMsgPayloadKeys?: string | null; webhookMe?: string | null; webhookSession?: string | null };
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
            <div>✅ WAHA está enviando eventos: último hace {minSinceHit} min ({hit.toLocaleString("es-ES")}) · <code>{diagnostics.webhookLastEvent ?? "—"}</code></div>
            {diagnostics.webhookLastMsgDecision ? (
              <div className="mt-1 rounded bg-white/70 border border-emerald-200 p-2 font-mono text-[11px] space-y-0.5">
                <div className="text-slate-500">— último MENSAJE recibido (no ack) —</div>
                <div>decisión: <strong>{diagnostics.webhookLastMsgDecision}</strong></div>
                <div>evento: {diagnostics.webhookLastMsgEvent ?? "—"}</div>
                {diagnostics.webhookLastMsgFrom && <div>de: {diagnostics.webhookLastMsgFrom}</div>}
                {diagnostics.webhookLastMsgBody && <div>texto: {diagnostics.webhookLastMsgBody}</div>}
                {diagnostics.webhookLastMsgPayloadKeys && <div>payload: {diagnostics.webhookLastMsgPayloadKeys}</div>}
              </div>
            ) : (
              <div className="mt-1 rounded bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800 space-y-1">
                <div>Solo han llegado <strong>acks/recibos de tus campañas</strong>; ningún mensaje ENTRANTE aún.</div>
                {diagnostics.webhookMe && (
                  <div className="font-mono">
                    📱 Número WAHA conectado: <strong>{diagnostics.webhookMe.replace(/@.*$/, "")}</strong>
                    {diagnostics.webhookSession ? ` · sesión: ${diagnostics.webhookSession}` : ""}
                  </div>
                )}
                <div>
                  Escribe <strong>exactamente a ese número</strong> desde otro teléfono. Si es el correcto y aun así no
                  entra, el webhook de WAHA no está suscrito a los mensajes entrantes → pulsa de nuevo
                  <strong> Configurar webhook ahora</strong> (reinicia la suscripción).
                </div>
              </div>
            )}
            <div className="mt-1">
              {diagnostics.webhookLastMsgDecision === "from_me"
                ? "El último mensaje se marcó como TUYO (fromMe). Escribe desde un teléfono que NO sea el de WAHA."
                : diagnostics.webhookLastMsgDecision === "missing_fields"
                  ? "Llegó un mensaje pero no se reconoció el texto con este motor. Pásame la caja de arriba (payload:) y ajusto el parseo."
                  : (diagnostics.webhookLastMsgDecision ?? "").startsWith("ingest_error")
                    ? "El mensaje llegó pero falló al guardarse. Pásame la caja de arriba."
                    : diagnostics.webhookLastMsgDecision === "ingested"
                      ? "¡El último mensaje SÍ se guardó! Pulsa Recargar."
                      : ""}
            </div>
          </div>
        ) : (
          <div className="text-xs space-y-2 bg-rose-50 border border-rose-200 rounded-md p-2.5 text-rose-800">
            <div>❌ WhatsApp aún no ha enviado NINGÚN webhook a este Hub.</div>
            <div>
              Que tus campañas <strong>envíen</strong> funciona aparte; para <strong>recibir</strong> las respuestas
              aquí hay que decirle a WAHA/Evolution que te las reenvíe. Pulsa el botón (no hace falta entrar en Ajustes):
            </div>
            <InlineWebhookButton />
            <div className="text-[11px] text-rose-600">
              Tras configurarlo, las respuestas aparecen <strong>en cuanto un lead te escriba</strong> (las anteriores no
              se importan). Si tu número está en estado <code>WORKING</code> y aun así no llega, escríbete tú mismo desde
              otro teléfono al número de la campaña para probar.
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
  const [reactivateOpen, setReactivateOpen] = useState(false);

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReactivateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm font-medium"
            title="Enrola en una secuencia a los leads contactados hace tiempo que no llegaron a cliente"
          >
            <RefreshCw className="h-4 w-4" />
            Reactivar leads fríos
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nueva secuencia
          </button>
        </div>
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
      <ReactivateModal open={reactivateOpen} onClose={() => setReactivateOpen(false)} sequences={items} />
    </div>
  );
}

/** Reactivación de leads fríos: enrola en una secuencia los leads contactados
 *  hace tiempo que no llegaron a cliente. */
function ReactivateModal({
  open,
  onClose,
  sequences
}: {
  open: boolean;
  onClose: () => void;
  sequences: any[];
}) {
  const [sequenceId, setSequenceId] = useState("");
  const [days, setDays] = useState(60);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ total: number; enrolled: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      setSequenceId(sequences[0]?.id ?? "");
    }
  }, [open, sequences]);

  async function run() {
    if (!sequenceId) { setError("Elige una secuencia."); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/v1/leads/sequences/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequenceId, olderThanDays: days })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setError(j?.error?.message ?? `Error ${r.status}`);
      else setResult({ total: j.total, enrolled: j.enrolled, failed: j.failed });
    } catch (e: any) {
      setError(e?.message ?? "Error de red");
    }
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={onClose} title="Reactivar leads fríos" size="sm" footer={
      <>
        <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cerrar</button>
        <button onClick={run} disabled={busy || !sequenceId} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Reactivar
        </button>
      </>
    }>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Enrola en la secuencia elegida a los leads <strong>contactados o que respondieron</strong> hace más de los días indicados y que <strong>no llegaron a cliente</strong> (excluye bajas). Ideal para recuperar los "ahora no".
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Secuencia</label>
          {sequences.length === 0 ? (
            <p className="text-sm text-amber-700">No hay secuencias. Crea una primero.</p>
          ) : (
            <select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-white text-sm">
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Contactados hace más de (días)</label>
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 60)} className="w-full px-3 py-2 rounded-lg border bg-white text-sm" />
        </div>
        {result && (
          <div className="text-xs rounded-lg border p-2.5 bg-emerald-50 border-emerald-200 text-emerald-800">
            ✓ {result.enrolled} lead(s) reactivado(s){result.failed > 0 ? ` · ${result.failed} omitido(s) (ya en secuencia o excluidos)` : ""}.
          </div>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

type StepDraft = { delayDays: number; templateBody: string; stopIfResponded: boolean; kind?: "text" | "ranking" };

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
  const [steps, setSteps] = useState<StepDraft[]>([{ delayDays: 0, templateBody: "", stopIfResponded: true, kind: "text" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setIsDefault(false);
    setSteps([{ delayDays: 0, templateBody: "", stopIfResponded: true, kind: "text" }]);
    setError(null);
  }, [open]);

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }
  function addStep() {
    setSteps((prev) => [...prev, { delayDays: 1, templateBody: "", stopIfResponded: true, kind: "text" }]);
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) { setError("Ponle un nombre a la secuencia."); return; }
    if (steps.length === 0) { setError("Añade al menos un paso."); return; }
    if (steps.some((st) => st.kind !== "ranking" && !st.templateBody.trim())) { setError("Cada paso de texto necesita un mensaje."); return; }
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
            kind: st.kind ?? "text",
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
                stopIfResponded: true,
                kind: "text" as const
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
                <select
                  value={st.kind ?? "text"}
                  onChange={(e) => updateStep(i, { kind: e.target.value as "text" | "ranking" })}
                  className="text-xs px-1.5 py-1 rounded border bg-white"
                  title="Tipo de paso"
                >
                  <option value="text">💬 Texto</option>
                  <option value="ranking">📊 Imagen posicionamiento</option>
                </select>
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
                placeholder={st.kind === "ranking" ? "Pie de foto (opcional). Vacío = automático según su posición en Google." : "Mensaje. Placeholders: {{nombre}}, {{provincia}}…"}
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
              />
              {st.kind === "ranking" && (
                <p className="text-[10px] text-amber-700">📊 Envía la imagen "tú vs competencia" de Google · cada envío = 1 consulta a Places (~0,03€/lead).</p>
              )}
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
      {/* Embudo premium: ticket-tier, fuente y secuencia de directivos */}
      <div className="grid md:grid-cols-2 gap-4">
        <ConversionTable title="💎 Conversión por valor (ticket)" colLabel="Tier" rows={data.convTier ?? []} />
        <ConversionTable title="Conversión por fuente de captación" colLabel="Fuente" rows={data.convSource ?? []} />
      </div>
      {data.exec && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">🎯 Embudo de directivos (secuencias)</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {([
              ["Secuencias", data.exec.total, "bg-white"],
              ["Activas", data.exec.active, "bg-indigo-50 text-indigo-700"],
              ["Completadas", data.exec.done, "bg-emerald-50 text-emerald-700"],
              ["Detenidas", data.exec.stopped, "bg-slate-50 text-slate-500"],
              ["Emails enviados", data.exec.emailsSent, "bg-amber-50 text-amber-700"]
            ] as const).map(([label, val, cls]) => (
              <div key={label} className={`rounded-lg border p-3 text-center ${cls}`}>
                <div className="text-xl font-bold">{val}</div>
                <div className="text-[11px] text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Conversión por nicho y por provincia */}
      <div className="grid md:grid-cols-2 gap-4">
        <ConversionTable title="Conversión por nicho" colLabel="Nicho" rows={data.convNiche ?? []} />
        <ConversionTable title="Conversión por provincia" colLabel="Provincia" rows={data.convProvince ?? []} />
      </div>
    </div>
  );
}

function ConversionTable({
  title,
  colLabel,
  rows
}: {
  title: string;
  colLabel: string;
  rows: any[];
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left font-medium">{colLabel}</th>
              <th className="px-2 py-2 text-right font-medium" title="Leads captados">Leads</th>
              <th className="px-2 py-2 text-right font-medium" title="Contactados (o más avanzados)">Contact.</th>
              <th className="px-2 py-2 text-right font-medium" title="% que respondió sobre contactados">Resp.</th>
              <th className="px-2 py-2 text-right font-medium" title="% que se hizo cliente sobre contactados">Clientes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-2 py-1.5 max-w-[160px] truncate font-medium" title={r.key}>{r.key}</td>
                <td className="px-2 py-1.5 text-right">{r.total}</td>
                <td className="px-2 py-1.5 text-right">{r.contacted}</td>
                <td className="px-2 py-1.5 text-right">{r.responseRate}%</td>
                <td className="px-2 py-1.5 text-right">
                  <span className={r.clientRate > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}>
                    {r.client} ({r.clientRate}%)
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-center text-slate-500">Sin datos todavía</td>
              </tr>
            )}
          </tbody>
        </table>
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
  | "bdns"
  | "meta_ads"
  | "jobs"
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
  { key: "borme", label: "BORME (constituciones)", status: "ready", help: "Sociedades recién constituidas (día 1, sin web ni GMB). Keyword \"ticket alto\" = solo sectores premium; \"capital\" = filtra por capital social." },
  { key: "bdns", label: "BDNS (recién subvencionados)", status: "ready", help: "Negocios que acaban de cobrar una subvención → presupuesto fresco. Gratis. Pon un número en el keyword (p.ej. \"20000\") para exigir importe mínimo. Teléfono enriquecido con Places." },
  { key: "meta_ads", label: "Meta Ad Library (ya anuncian)", status: "ready", help: "Negocios que YA pagan anuncios en Facebook/Instagram → ticket alto. Requiere el token de Meta en Ajustes. El teléfono se enriquece con Google Places." },
  { key: "jobs", label: "Empleos (buscan marketing/IA)", status: "ready", help: "Empresas con una oferta abierta de marketing/IA (LinkedIn + InfoJobs) → ya tienen presupuesto y necesidad. Les llega un EMAIL automático ofreciendo hacerlo como servicio, mencionando su vacante. Requiere Scrapfly (Ajustes) + RESEND para el envío. Keyword = puesto (ej: \"marketing\", \"community manager\", \"IA\")." },
  { key: "doctoralia", label: "Doctoralia (clínicas)", status: "ready", help: "Médicos, dentistas, fisios. Requiere API key de Scrapfly en Ajustes. El teléfono se enriquece con Google Places." },
  { key: "idealista", label: "Idealista (inmobiliarias)", status: "ready", help: "Inmobiliarias y promotoras. Requiere API key de Scrapfly en Ajustes." },
  { key: "fotocasa", label: "Fotocasa (inmobiliarias)", status: "ready", help: "Inmobiliarias listadas en Fotocasa. Requiere API key de Scrapfly en Ajustes." },
  { key: "trustpilot", label: "Trustpilot (reseñas bajas)", status: "stub", help: "Próximamente — falta configurar scraper." },
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
  const [useSynonyms, setUseSynonyms] = useState(false);
  const [useGrid, setUseGrid] = useState(false);
  const [mobileOnly, setMobileOnly] = useState(false);
  const [cacheReuse, setCacheReuse] = useState(false);
  const [estCache, setEstCache] = useState<{ targets: number; cached: number; billable: number } | null>(null);
  const [allSources, setAllSources] = useState(false);
  const [cfg, setCfg] = useState<{ metaAdsConfigured?: boolean; scrapflyConfigured?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceMeta = LEAD_SOURCES.find((s) => s.key === source) ?? LEAD_SOURCES[0];
  const municipios = province ? municipalitiesForProvince(province) : [];
  // Con la caché activada, consultamos al backend cuántas áreas ya están
  // barridas (<30 días) para restarlas del coste estimado (#4). Debounced.
  useEffect(() => {
    if (source !== "places" || !cacheReuse || !keyword.trim()) {
      setEstCache(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams({
        keyword: keyword.trim(),
        scope,
        location: location.trim(),
        municipality: scope === "custom" && municipality ? municipality : "",
        grid: useGrid ? "1" : "0",
        cacheDays: "30"
      });
      fetch(`/api/v1/leads/searches/estimate?${params.toString()}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setEstCache(d))
        .catch(() => {});
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [source, cacheReuse, keyword, scope, location, municipality, useGrid]);
  // Estimación de consultas/coste antes de lanzar (espejo de la lógica del backend).
  const estVariants = useSynonyms ? 3 : 1;
  const provName = province || (PROVINCE_NAMES.includes(location.trim()) ? location.trim() : "");
  let estTargets = 1;
  if (source === "places") {
    if (scope === "spain") estTargets = useGrid ? SPAIN_MUNI_TOTAL : 52;
    else if (municipality) estTargets = useGrid ? 49 : 1;
    else if (provName) estTargets = useGrid ? 64 : Math.max(1, municipalitiesForProvince(provName).length);
    else estTargets = 1;
  }
  const estQueries = estTargets * estVariants;
  const estCostEur = estQueries * EUR_POR_CONSULTA;
  const estCostStr = estCostEur >= 10 ? `${Math.round(estCostEur)}€` : `${estCostEur.toFixed(2)}€`;
  const showEst = source === "places" && estQueries > 1;
  // Coste real esperado restando lo que ahorra la caché (#4).
  const cacheOn = cacheReuse && !!estCache;
  const cachedQueries = cacheOn ? (estCache?.cached ?? 0) * estVariants : 0;
  const billableQueries = cacheOn ? (estCache?.billable ?? estTargets) * estVariants : estQueries;
  const realCostEur = billableQueries * EUR_POR_CONSULTA;
  const realCostStr = realCostEur >= 10 ? `${Math.round(realCostEur)}€` : `${realCostEur.toFixed(2)}€`;
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
    setUseSynonyms(false);
    setUseGrid(false);
    setMobileOnly(false);
    setCacheReuse(false);
    setAllSources(false);
    setError(null);
    setSaving(false);
    // Para saber qué fuentes premium están activas (con su key).
    fetch("/api/v1/leads/settings").then((r) => (r.ok ? r.json() : null)).then(setCfg).catch(() => {});
  }, [open]);

  /** Fuentes a lanzar cuando se elige "todas": places + borme siempre; las
   *  premium solo si tienen su key configurada. */
  async function createOne(src: LeadSourceKey | "all") {
    return fetch("/api/v1/leads/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        location,
        scope,
        municipality: src === "places" && scope === "custom" && municipality ? municipality : undefined,
        skipExisting,
        source: src,
        sourceConfig:
          src === "places" && (lowRatingOnly || useSynonyms || useGrid || mobileOnly || cacheReuse)
            ? {
                ...(lowRatingOnly ? { lowRatingOnly: true, maxRating: 3.5, minReviewsCount: 5 } : {}),
                ...(useSynonyms ? { useSynonyms: true } : {}),
                ...(useGrid ? { useGrid: true } : {}),
                ...(mobileOnly ? { mobileOnly: true } : {}),
                ...(cacheReuse ? { cacheDays: 30 } : {})
              }
            : undefined
      })
    });
  }

  async function save() {
    // Empleos no exige keyword: vacío = todos los puestos de marketing/IA. El
    // resto de fuentes (y "todas") sí necesitan un nicho.
    if (!keyword.trim() && !(source === "jobs" && !allSources)) { setError("Falta el keyword / nicho a buscar"); return; }
    // places y jobs exigen localidad en scope custom (también si lanzamos "todas").
    if ((source === "places" || source === "jobs" || allSources) && scope === "custom" && !location.trim()) {
      setError("Falta la provincia / localidad");
      return;
    }
    if (!allSources && sourceMeta.status === "stub") {
      setError(sourceMeta.help);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (allSources) {
        // El backend crea una búsqueda por cada fuente lista (incluye BDNS y
        // salta las que no tengan su key configurada).
        const r = await createOne("all");
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j?.error?.message ?? `Error ${r.status}`);
          setSaving(false);
          return;
        }
      } else {
        const r = await createOne(source);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j?.error?.message ?? `Error ${r.status}`);
          setSaving(false);
          return;
        }
      }
    } finally {
      setSaving(false);
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
          <label className="flex items-center gap-2 mb-1.5 text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2.5 py-1.5 cursor-pointer">
            <input type="checkbox" checked={allSources} onChange={(e) => setAllSources(e.target.checked)} className="accent-brand-600" />
            🌐 Atacar el nicho con TODAS las fuentes a la vez
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as LeadSourceKey)}
            disabled={allSources}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-50"
          >
            {LEAD_SOURCES.map((src) => (
              <option key={src.key} value={src.key}>
                {src.status === "stub" ? `${src.label} (próximamente)` : src.label}
              </option>
            ))}
          </select>
          <p className={"text-[11px] mt-1 " + (sourceMeta.status === "stub" ? "text-amber-700" : "text-slate-500")}>
            {allSources
              ? "Se creará una búsqueda por cada fuente lista (Places, BORME, BDNS y las premium que tengan su key en Ajustes)."
              : sourceMeta.help}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            {source === "jobs" ? "Puesto a buscar (opcional)" : "Tipo de negocio"}
          </label>
          {/* El selector de "tipo de negocio" (dentista, plomero…) no aplica a
              Empleos: ahí el keyword es el PUESTO, no el nicho de la empresa. */}
          {source !== "jobs" && (
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
          )}
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={
              source === "borme"
                ? "Sector / palabra clave (filtra empresas del BORME)"
                : source === "jobs"
                  ? "Puesto: marketing, community manager, IA… (vacío = todos los de marketing/IA)"
                  : "…o escribe la palabra clave (ej: plomero, dentista, abogado)"
            }
            className={"w-full px-3 py-2 rounded-lg border bg-white text-sm " + (source === "jobs" ? "" : "mt-2")}
          />
          {source === "jobs" && (
            <p className="text-[11px] text-slate-500 mt-1">
              Déjalo <strong>vacío</strong> para captar empresas de <strong>cualquier sector</strong> que
              contraten marketing/IA (community manager, publicidad, SEO/SEM, growth, IA, data…). O escribe un
              puesto concreto para acotar.
            </p>
          )}
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
        {source === "jobs" && scope === "custom" && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Provincia / localidad</label>
            <select
              value={PROVINCE_NAMES.includes(location) ? location : ""}
              onChange={(e) => {
                setProvince(e.target.value);
                setMunicipality("");
                setLocation(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
            >
              <option value="">— Elige provincia —</option>
              {PROVINCE_NAMES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setProvince("");
                setMunicipality("");
              }}
              placeholder="…o escribe la provincia / ciudad a mano (ej: Málaga)"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
            />
            <p className="text-[11px] text-slate-500">
              Solo se traerán ofertas de empresas <strong>en España</strong> y, si eliges zona, de esa
              provincia/ciudad (incluye sus municipios). Déjalo en "Toda España" para no filtrar por zona.
            </p>
          </div>
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
          <label className="flex items-start gap-2 p-2 rounded-md border bg-slate-50/60 cursor-pointer">
            <input
              type="checkbox"
              checked={useSynonyms}
              onChange={(e) => setUseSynonyms(e.target.checked)}
              className="mt-0.5 accent-brand-600"
            />
            <div className="flex-1">
              <span className="text-xs font-medium text-slate-800">🔁 Buscar también sinónimos del nicho</span>
              <p className="text-[11px] text-slate-500">
                Lanza la búsqueda también con variantes ("dentista" → "clínica dental", "odontólogo").
                Más resultados, pero multiplica el coste de la API de Google.
              </p>
            </div>
          </label>
        )}
        {source === "places" && (
          <label className="flex items-start gap-2 p-2 rounded-md border border-emerald-200 bg-emerald-50/50 cursor-pointer">
            <input
              type="checkbox"
              checked={useGrid}
              onChange={(e) => setUseGrid(e.target.checked)}
              className="mt-0.5 accent-emerald-600"
            />
            <div className="flex-1">
              <span className="text-xs font-medium text-slate-800">🗺️ Búsqueda por cuadrícula (cobertura densa del núcleo)</span>
              <p className="text-[11px] text-slate-500">
                Divide la zona en una rejilla y consulta cada celda para superar el tope de ~60
                de Google, <strong>denso en el núcleo urbano</strong>.
                {scope === "spain" ? (
                  <>
                    {" "}En "Toda España" busca en <strong>todos los municipios del país</strong> (~8.000)
                    → cobertura total, pero tarda y consume muchas más llamadas.
                  </>
                ) : municipality ? (
                  <>
                    {" "}En una ciudad concreta <strong>multiplica</strong> las consultas (≈49 celdas
                    frente a 1 sin cuadrícula): más cobertura y más coste.
                  </>
                ) : provName ? (
                  <>
                    {" "}Ojo: a nivel <strong>provincia sale MÁS BARATA</strong> — usa 64 celdas fijas
                    frente a las {municipalitiesForProvince(provName).length.toLocaleString("es")} consultas
                    de "un pueblo por municipio" del modo normal. A cambio es más densa en el área
                    metropolitana pero puede dejar fuera pueblos alejados. Para barrer <strong>todos los
                    pueblos</strong>, déjala sin marcar.
                  </>
                ) : (
                  <> Captura <strong>muchos más negocios</strong> en zonas densas.</>
                )}
              </p>
            </div>
          </label>
        )}
        {source === "places" && (
          <label className="flex items-start gap-2 p-2 rounded-md border border-sky-200 bg-sky-50/50 cursor-pointer">
            <input
              type="checkbox"
              checked={mobileOnly}
              onChange={(e) => setMobileOnly(e.target.checked)}
              className="mt-0.5 accent-sky-600"
            />
            <div className="flex-1">
              <span className="text-xs font-medium text-slate-800">📱 Solo negocios con móvil (WhatsApp real)</span>
              <p className="text-[11px] text-slate-500">
                Descarta fijos (8/9) y fichas sin teléfono; deja solo <strong>móviles (6/7)</strong>,
                que son los que de verdad reciben WhatsApp. Menos cola muerta y mejor entrega.
              </p>
            </div>
          </label>
        )}
        {source === "places" && (
          <label className="flex items-start gap-2 p-2 rounded-md border border-teal-200 bg-teal-50/50 cursor-pointer">
            <input
              type="checkbox"
              checked={cacheReuse}
              onChange={(e) => setCacheReuse(e.target.checked)}
              className="mt-0.5 accent-teal-600"
            />
            <div className="flex-1">
              <span className="text-xs font-medium text-slate-800">♻️ No rebuscar zonas barridas hace &lt; 30 días</span>
              <p className="text-[11px] text-slate-500">
                Salta las consultas de áreas (keyword + zona) ya barridas hace menos de 30 días →
                <strong> ahorra muchas llamadas a la API</strong> al rebuscar a menudo. Contrapartida:
                un negocio nuevo en esa zona puede tardar hasta 30 días en aparecer.
              </p>
            </div>
          </label>
        )}
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
        {showEst && (
          <div
            className={
              "rounded-md border px-2.5 py-2 text-[11px] " +
              (estQueries > 1500
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-slate-200 bg-slate-50 text-slate-600")
            }
          >
            {cacheOn ? (
              <>
                📊 Estimación: <strong>≈ {billableQueries.toLocaleString("es")} consultas reales</strong> ·
                coste aprox. <strong>~{realCostStr}</strong>
                <div className="mt-0.5 text-[10px] opacity-80">
                  de {estQueries.toLocaleString("es")} totales · ♻️ {cachedQueries.toLocaleString("es")} en caché
                  (se saltan, ahorras ~{(estCostEur - realCostEur >= 10 ? Math.round(estCostEur - realCostEur) : (estCostEur - realCostEur).toFixed(2))}€)
                </div>
              </>
            ) : (
              <>
                📊 Estimación: <strong>≈ {estQueries.toLocaleString("es")} consultas</strong> a Google ·
                coste aprox. <strong>~{estCostStr}</strong>
                {estQueries > 1500 && (
                  <span> · captación grande: se procesa por batches del cron y puede tardar.</span>
                )}
              </>
            )}
          </div>
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
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Mensaje. Placeholders disponibles: {{nombre_negocio}}, {{provincia}}, {{rating}}, {{competidor_top}}, {{opener_ia}}, {{demo_bubui}}, ..." className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
        <p className="text-[11px] text-slate-500">
          💡 <code>{"{{demo_bubui}}"}</code> inserta el enlace a una demo personalizada de cómo se vería ese negocio en Bubui — ideal para captar con un envío.
        </p>
        <p className="text-[11px] text-emerald-700">
          ⚡ <code>{"{{enlace_bubui}}"}</code> crea su ficha de Bubui y mete el <strong>enlace de activación</strong> único (entra sin contraseña y la activa). Se genera al enviar, uno por negocio.
        </p>
        {!isEdit && (
          <button
            type="button"
            onClick={() => {
              setName("Activación Bubui");
              setBody(
                "Hola {{nombre_negocio}} 👋\n\n" +
                  "Soy de Negocio Vivo. Os he preparado vuestra ficha en Bubui (la app con la que vuestros clientes vuelven y traen amigos) usando vuestros datos de Google.\n\n" +
                  "Ya está montada, solo falta que la activéis vosotros:\n" +
                  "{{enlace_bubui}}\n\n" +
                  "Al abrir el enlace entráis sin contraseña y la activáis en 1 minuto. ¿Le echáis un vistazo?"
              );
            }}
            className="text-[11px] px-2.5 py-1 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium"
          >
            ⚡ Usar ejemplo: Activación Bubui
          </button>
        )}
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
  const [wahaPanelUsername, setWahaPanelUsername] = useState("");
  const [wahaPanelPassword, setWahaPanelPassword] = useState("");
  const [evoKey, setEvoKey] = useState("");
  const [metaAdsKey, setMetaAdsKey] = useState("");
  const [scrapflyKey, setScrapflyKey] = useState("");
  const [hunterKey, setHunterKey] = useState("");
  const [apolloKey, setApolloKey] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [elevenVoiceId, setElevenVoiceId] = useState("");
  const [testingVoice, setTestingVoice] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  // Resultado de "Probar" proxy por clave ("__global__" o nombre de canal).
  const [proxyTest, setProxyTest] = useState<Record<string, { loading?: boolean; ok?: boolean; exitIp?: string; ms?: number; error?: string; checkedAt?: string; justFailed?: boolean }>>({});
  async function testProxy(key: string, proxy: string, channel?: string) {
    setProxyTest((p) => ({ ...p, [key]: { loading: true } }));
    try {
      const r = await fetch("/api/v1/leads/proxy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channel ? { channel } : { proxy })
      });
      const j = await r.json().catch(() => ({ ok: false, error: "Respuesta no válida" }));
      setProxyTest((p) => ({ ...p, [key]: { ...j } }));
    } catch (e: any) {
      setProxyTest((p) => ({ ...p, [key]: { ok: false, error: e?.message ?? "Error de red" } }));
    }
  }
  function proxyStatusView(key: string) {
    const st = proxyTest[key] ?? s?.proxyStatus?.[key];
    if (!st) return null;
    if (st.loading) return <span className="text-[11px] text-slate-500 ml-1">probando…</span>;
    if (st.ok)
      return (
        <span className="text-[11px] text-emerald-700 ml-1" title={st.checkedAt ? `Comprobado: ${new Date(st.checkedAt).toLocaleString("es-ES")}` : undefined}>
          ✅ IP {st.exitIp}{st.ms ? ` · ${st.ms} ms` : ""}
        </span>
      );
    return <span className="text-[11px] text-rose-600 ml-1" title={st.error}>❌ {st.error ?? "no funciona"}</span>;
  }
  const [health, setHealth] = useState<any[] | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  // Estado de conexión en vivo por número (sesión WAHA): WORKING / SCAN_QR_CODE / …
  const [chanStatus, setChanStatus] = useState<Record<string, string>>({});
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
  const [loadError, setLoadError] = useState<string | null>(null);
  // Conectar un número concreto: muestra su QR (la sesión/instancia se crea
  // sola en el servidor si no existe). channelQr = nombre del canal abierto.
  // OJO: declarado AQUÍ (antes de cualquier return) para no romper el orden de
  // hooks — estaba más abajo y provocaba React error #310 al cargar Ajustes.
  const [channelQr, setChannelQr] = useState<string | null>(null);
  const [channelQrErr, setChannelQrErr] = useState<string | null>(null);
  const [channelQrNonce, setChannelQrNonce] = useState(0);
  function loadSettings() {
    setLoadError(null);
    fetch("/api/v1/leads/settings")
      .then(async (r) => {
        if (r.ok) return r.json();
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error?.message ?? `No se pudieron cargar los ajustes (HTTP ${r.status})`);
      })
      .then((d) => { setS(d); setElevenVoiceId(d?.elevenLabsVoiceId ?? ""); })
      .catch((e) => setLoadError(e?.message ?? "Error al cargar los ajustes"));
  }
  useEffect(() => {
    if (!open) return;
    setGoogleKey(""); setWahaKey(""); setWahaPanelUsername(""); setWahaPanelPassword(""); setEvoKey(""); setMetaAdsKey(""); setScrapflyKey(""); setHunterKey(""); setApolloKey(""); setElevenKey(""); setError(null); setSavedAt(null);
    setS(null);
    loadSettings();
  }, [open]);
  // Estado de conexión de cada número, refrescado cada 12s mientras el modal abierto.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () =>
      fetch("/api/v1/leads/channels-status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.statuses) setChanStatus(d.statuses); })
        .catch(() => {});
    load();
    const id = setInterval(load, 12000);
    return () => { alive = false; clearInterval(id); };
  }, [open]);
  function chanBadge(name?: string) {
    const n = (name ?? "").trim();
    if (!n) return null;
    const st = chanStatus[n];
    const base = "text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap";
    if (st === undefined) return <span className={`${base} bg-slate-50 text-slate-400 border-slate-200`}>⋯</span>;
    if (st === "WORKING") return <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>🟢 Conectado</span>;
    if (st === "SCAN_QR_CODE") return <span className={`${base} bg-amber-50 text-amber-700 border-amber-200`}>🟡 Escanea QR</span>;
    if (st === "STARTING") return <span className={`${base} bg-amber-50 text-amber-700 border-amber-200`}>🟡 Iniciando</span>;
    return <span className={`${base} bg-rose-50 text-rose-700 border-rose-200`} title={st}>🔴 Desconectado</span>;
  }
  useEffect(() => {
    if (!open) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setReconnecting(false);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [open]);
  if (!s)
    return (
      <Modal open={open} onClose={onClose} title="Ajustes leads" size="lg">
        {loadError ? (
          <div className="p-4 text-sm space-y-3">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700">✗ {loadError}</div>
            <button onClick={loadSettings} className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium">
              Reintentar
            </button>
          </div>
        ) : (
          <Loading />
        )}
      </Modal>
    );
  async function save(): Promise<boolean> {
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
      ayuntamiento: s.ayuntamiento ?? "",
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
      maxAttempts: s.maxAttempts,
      maxPerHour: s.maxPerHour,
      minCoolDownDaysPerRecipient: s.minCoolDownDaysPerRecipient,
      maxNewChatsPerDay: s.maxNewChatsPerDay,
      recoveryMode: !!s.recoveryMode,
      recoveryByChannel: s.recoveryByChannel ?? {},
      recoveryDurationDays: s.recoveryDurationDays,
      warmupEnabled: s.warmupEnabled,
      warmupDays: s.warmupDays,
      warmupStartCap: s.warmupStartCap,
      warmupChatEnabled: s.warmupChatEnabled,
      principalPhone: s.principalPhone,
      voiceSpeed: s.voiceSpeed,
      voiceShorten: s.voiceShorten,
      voiceMaxSeconds: s.voiceMaxSeconds,
      autoRecoveryEnabled: s.autoRecoveryEnabled,
      dailyJitterPct: s.dailyJitterPct,
      wahaProxy: s.wahaProxy ?? null,
      blockLinksInFirstMessage: s.blockLinksInFirstMessage,
      replyRateGuardEnabled: s.replyRateGuardEnabled,
      followupTaskEnabled: s.followupTaskEnabled,
      channels: Array.isArray(s.channels) ? s.channels : []
    };
    // La clave de Google SOLO se guarda si parece real (AIza…). Esto evita el
    // bug de que el autocompletado del navegador/gestor de contraseñas rellene
    // el campo password con una credencial guardada y, al Guardar, sobrescriba
    // la clave válida con basura (→ API_KEY_INVALID). Si no parece clave, se
    // ignora en silencio y NO se toca la guardada (ni bloquea guardar el resto).
    const gk = googleKey.trim();
    if (gk && /^AIza[\w-]{20,}$/.test(gk)) body.googleApiKey = gk;
    if (wahaKey) body.wahaApiKey = wahaKey;
    if (wahaPanelUsername.trim()) body.wahaPanelUsername = wahaPanelUsername.trim();
    if (wahaPanelPassword.trim()) body.wahaPanelPassword = wahaPanelPassword.trim();
    if (evoKey) body.evolutionApiKey = evoKey;
    if (metaAdsKey) body.metaAdsToken = metaAdsKey;
    if (scrapflyKey) body.scrapflyApiKey = scrapflyKey;
    if (hunterKey) body.hunterApiKey = hunterKey;
    if (apolloKey) body.apolloApiKey = apolloKey;
    if (elevenKey.trim()) body.elevenLabsApiKey = elevenKey.trim();
    body.elevenLabsVoiceId = elevenVoiceId.trim();
    const r = await fetch("/api/v1/leads/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return false;
    }
    if (wahaPanelUsername.trim() || wahaPanelPassword.trim()) {
      setS((prev: any) => ({
        ...prev,
        wahaPanelUsernameConfigured: prev?.wahaPanelUsernameConfigured || !!wahaPanelUsername.trim(),
        wahaPanelPasswordConfigured: prev?.wahaPanelPasswordConfigured || !!wahaPanelPassword.trim()
      }));
      setWahaPanelUsername("");
      setWahaPanelPassword("");
    }
    setSavedAt(new Date());
    return true;
  }
  async function testVoice() {
    setTestingVoice(true);
    setVoiceMsg(null);
    try {
      // Guarda primero (por si cambió la key/voz) y luego genera la muestra.
      const okSaved = await save();
      if (!okSaved) { setTestingVoice(false); return; }
      const r = await fetch("/api/v1/leads/voice/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.audioBase64) {
        setVoiceMsg(j?.error?.message ?? `No se pudo generar la voz (HTTP ${r.status}).`);
        return;
      }
      const audio = new Audio(`data:audio/mpeg;base64,${j.audioBase64}`);
      await audio.play().catch(() => setVoiceMsg("Audio generado, pero el navegador bloqueó la reproducción. Reintenta."));
      setVoiceMsg("✓ Voz generada y reproduciéndose.");
    } catch (e: any) {
      setVoiceMsg(e?.message ?? "Error probando la voz.");
    } finally {
      setTestingVoice(false);
    }
  }
  function setField(k: string, v: any) { setS({ ...s, [k]: v }); }

  // WAHA solo admite nombres de sesión con [a-z A-Z 0-9 _ -] (sin espacios ni
  // tildes). Saneamos al escribir para que el QR no falle con 400 "Session name
  // can only contain alphanumeric characters...". La descripción va en la etiqueta.
  function sanitizeSessionName(v: string): string {
    return (v || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita tildes/acentos
      .replace(/[^a-zA-Z0-9_-]+/g, "-")                 // espacios y otros -> guion
      .replace(/-{2,}/g, "-")                           // colapsa guiones
      .replace(/^-+/, "");                              // sin guion al inicio
  }

  function updateChannel(i: number, patch: any) {
    const arr = [...(s.channels ?? [])];
    arr[i] = { ...arr[i], ...patch };
    setField("channels", arr);
  }
  function removeChannel(i: number) {
    setField("channels", (s.channels ?? []).filter((_: any, idx: number) => idx !== i));
  }
  async function loadHealth() {
    setLoadingHealth(true);
    try {
      const r = await fetch("/api/v1/leads/channels-health");
      const j = await r.json().catch(() => ({}));
      setHealth(j.items ?? []);
    } catch {
      setHealth([]);
    }
    setLoadingHealth(false);
  }
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
      // Llama al setup del proveedor activo: Evolution o WAHA. Antes solo
      // existía el de WAHA, así que con Evolution el webhook nunca se
      // registraba y el Inbox no recibía mensajes.
      const endpoint =
        s.whatsappProvider === "evolution"
          ? "/api/v1/leads/evolution-webhook-setup"
          : "/api/v1/leads/waha-webhook-setup";
      const r = await fetch(endpoint, { method: "POST" });
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
  // REINICIO TOTAL: borra y recrea la sesión en WAHA para desatascar un STARTING
  // clavado / FAILED, sin panel de WAHA. Tras esto hay que reescanear el QR.
  async function resetWahaSession(session?: string, noProxy?: boolean) {
    const label = session ? `el número "${session}"` : "el número principal (default)";
    if (
      !confirm(
        `¿REINICIO TOTAL de ${label}${noProxy ? " SIN PROXY" : ""}?\n\nBorra la vinculación en WAHA y la recrea de cero para desatascarla (STARTING clavado / FAILED).${
          noProxy ? "\n\nSe recrea SIN proxy: si con esto sí sale el QR, el problema era el proxy." : ""
        }\n\n⚠️ Tendrás que ESCANEAR EL QR de nuevo.`
      )
    )
      return;
    // Para un canal extra hay que tenerlo guardado en Ajustes (el endpoint lo exige).
    if (session) {
      const ok = await save();
      if (!ok) return;
    }
    setReconnecting(true);
    setWahaTest(null);
    try {
      const params = new URLSearchParams();
      if (session) params.set("session", session);
      if (noProxy) params.set("noProxy", "1");
      const qs = params.toString();
      const url = "/api/v1/leads/waha-reset" + (qs ? `?${qs}` : "");
      const r = await fetch(url, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        const msg = j?.message ?? j?.error?.message ?? "No se pudo reiniciar la sesión.";
        if (session) setChannelQrErr(msg);
        else setWahaTest({ ok: false, message: msg });
        setReconnecting(false);
        return;
      }
    } catch (e: any) {
      const msg = `No se pudo reiniciar: ${e?.message ?? e}`;
      if (session) setChannelQrErr(msg);
      else setWahaTest({ ok: false, message: msg });
      setReconnecting(false);
      return;
    }
    if (session) {
      // Abrir/refrescar el QR de ese canal.
      setChannelQrErr(null);
      setChannelQrNonce((n) => n + 1);
      setChannelQr(session);
      setReconnecting(false);
      return;
    }
    // Principal: sondear estado + refrescar QR (igual que reconnectWaha).
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
        if (j.ok || ticks > 60) {
          stopPoll();
          setReconnecting(false);
        }
      } catch {
        /* sigue sondeando */
      }
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
          <input type="password" value={googleKey} onChange={(e) => setGoogleKey(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" name="nv-google-places-key" placeholder={s.googleConfigured ? "•••• (configurada, deja vacío para no cambiar)" : "AIza..."} className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
          <p className="mt-1 text-[11px] text-slate-500">Se cifra con AES-256-GCM. Requiere Places API habilitada.</p>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2">💎 Fuentes premium de captación</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Token de Meta Ad Library {s.metaAdsConfigured && <span className="text-emerald-600">· configurado ✓</span>}
              </label>
              <input
                type="password"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                value={metaAdsKey}
                onChange={(e) => setMetaAdsKey(e.target.value)}
                placeholder={s.metaAdsConfigured ? "•••• (configurado, deja vacío para no cambiar)" : "APPID|APPSECRET o un user token de Meta"}
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono"
              />
              <p className="mt-1 text-[11px] text-slate-500">Activa la fuente <strong>Meta Ad Library</strong> (negocios que ya anuncian). Un app token <code>APPID|APPSECRET</code> sirve. Se cifra.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                API key de Scrapfly {s.scrapflyConfigured && <span className="text-emerald-600">· configurada ✓</span>}
              </label>
              <input
                type="password"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                value={scrapflyKey}
                onChange={(e) => setScrapflyKey(e.target.value)}
                placeholder={s.scrapflyConfigured ? "•••• (configurada, deja vacío para no cambiar)" : "scp-live-..."}
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono"
              />
              <p className="mt-1 text-[11px] text-slate-500">Activa las fuentes <strong>Doctoralia, Idealista y Fotocasa</strong>. Se cifra.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                API key de Hunter (verificar emails) {s.hunterConfigured && <span className="text-emerald-600">· configurada ✓</span>}
              </label>
              <input
                type="password"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                value={hunterKey}
                onChange={(e) => setHunterKey(e.target.value)}
                placeholder={s.hunterConfigured ? "•••• (configurada, deja vacío para no cambiar)" : "Hunter.io API key"}
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono"
              />
              <p className="mt-1 text-[11px] text-slate-500">En el <strong>🎯 Kit directivo</strong>: encuentra y <strong>verifica</strong> el email del directivo antes de enviar. Se cifra.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                API key de Apollo (encontrar decisor) {s.apolloConfigured && <span className="text-emerald-600">· configurada ✓</span>}
              </label>
              <input
                type="password"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                value={apolloKey}
                onChange={(e) => setApolloKey(e.target.value)}
                placeholder={s.apolloConfigured ? "•••• (configurada, deja vacío para no cambiar)" : "Apollo.io API key"}
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono"
              />
              <p className="mt-1 text-[11px] text-slate-500">En el <strong>🎯 Kit directivo</strong>: encuentra al decisor (nombre, cargo, LinkedIn, email) por dominio. Se cifra.</p>
            </div>
          </div>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2">🎙️ Voz IA (ElevenLabs)</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                API key de ElevenLabs {s.elevenLabsConfigured && <span className="text-emerald-600">· configurada ✓</span>}
              </label>
              <input
                type="password"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                value={elevenKey}
                onChange={(e) => setElevenKey(e.target.value)}
                placeholder={s.elevenLabsConfigured ? "•••• (configurada, deja vacío para no cambiar)" : "ElevenLabs API key"}
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">ID de la voz (Voice ID)</label>
              <input
                value={elevenVoiceId}
                onChange={(e) => setElevenVoiceId(e.target.value)}
                placeholder="Ej: 21m00Tcm... (tu voz clonada o una del catálogo)"
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Activa el envío de <strong>notas de voz IA</strong>. Clona tu voz en ElevenLabs (Voice Lab) y pega aquí su Voice ID. Se cifra la key.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Velocidad de habla ({(s.voiceSpeed ?? 1).toFixed(2)}×)</label>
                <input
                  type="range" min={0.8} max={1.2} step={0.05}
                  value={s.voiceSpeed ?? 1}
                  onChange={(e) => setField("voiceSpeed", Number(e.target.value))}
                  className="w-full accent-violet-600"
                />
                <p className="text-[10px] text-slate-400">1.0 = normal · sube a ~1.10 para que hable más rápido.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Duración objetivo (seg)</label>
                <input
                  type="number" min={8} max={60}
                  value={s.voiceMaxSeconds ?? 18}
                  onChange={(e) => setField("voiceMaxSeconds", Number(e.target.value) || 18)}
                  className="w-full px-2 py-1 rounded border bg-white text-sm"
                />
                <label className="flex items-center gap-1.5 text-[11px] text-slate-600 mt-1 cursor-pointer">
                  <input type="checkbox" checked={s.voiceShorten ?? true} onChange={(e) => setField("voiceShorten", e.target.checked)} className="accent-violet-600" />
                  Acortar el guion con IA (ir al grano)
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={testVoice}
                disabled={testingVoice || (!elevenVoiceId.trim() && !s.elevenLabsConfigured)}
                className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium"
              >
                {testingVoice ? "Generando…" : "▶ Probar voz"}
              </button>
              {voiceMsg && <span className={`text-[11px] ${voiceMsg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>{voiceMsg}</span>}
            </div>
            <p className="text-[10px] text-slate-400">Guarda los ajustes y genera una nota de voz de muestra para oír cómo suena.</p>
          </div>
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
                <input type="password" autoComplete="off" data-lpignore="true" data-1p-ignore value={evoKey} onChange={(e) => setEvoKey(e.target.value)} placeholder={s.evolutionConfigured ? "•••• (configurada)" : "API key (apikey global de Evolution)"} className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={s.evolutionInstance ?? "default"} onChange={(e) => setField("evolutionInstance", e.target.value)} placeholder="Nombre instancia" className="px-3 py-2 rounded-lg border bg-white text-sm" />
                  <input value={s.whatsappCountryCode ?? "34"} onChange={(e) => setField("whatsappCountryCode", e.target.value)} placeholder="Código país (34)" className="px-3 py-2 rounded-lg border bg-white text-sm" />
                </div>
              </>
            ) : (
              <>
                <input value={s.wahaUrl ?? ""} onChange={(e) => setField("wahaUrl", e.target.value)} placeholder="https://waha.ejemplo.com" className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
                <input type="password" autoComplete="off" data-lpignore="true" data-1p-ignore value={wahaKey} onChange={(e) => setWahaKey(e.target.value)} placeholder={s.wahaConfigured ? "•••• (configurada)" : "API key WAHA"} className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore
                    value={wahaPanelUsername}
                    onChange={(e) => setWahaPanelUsername(e.target.value)}
                    placeholder={s.wahaPanelUsernameConfigured ? "Usuario del panel (configurado)" : "Usuario del panel WAHA"}
                    className="px-3 py-2 rounded-lg border bg-white text-sm font-mono"
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore
                    value={wahaPanelPassword}
                    onChange={(e) => setWahaPanelPassword(e.target.value)}
                    placeholder={s.wahaPanelPasswordConfigured ? "Contraseña del panel (configurada)" : "Contraseña del panel WAHA"}
                    className="px-3 py-2 rounded-lg border bg-white text-sm font-mono"
                  />
                </div>
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
            <div className="mt-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">🏛️ Ayuntamiento colaborador (opcional)</label>
              <input
                value={s.ayuntamiento ?? ""}
                onChange={(e) => setField("ayuntamiento", e.target.value)}
                placeholder="Ej: Benalmádena"
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Si colaboráis con un ayuntamiento, ponlo aquí. Las plantillas que usen <code>{"{{colaboracion_ayto}}"}</code> añadirán
                automáticamente “En colaboración con el Ayuntamiento de …”. Déjalo vacío para no nombrar a nadie.
              </p>
            </div>
            <div className="mt-2 rounded-lg border bg-emerald-50/50 p-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!s.autoReplyEnabled}
                  onChange={(e) => setField("autoReplyEnabled", e.target.checked)}
                  className="accent-emerald-600"
                />
                🤖 Auto-respuesta al primer mensaje de un lead
              </label>
              <p className="text-[11px] text-slate-500 mt-1">
                Cuando un lead te escribe por primera vez, se le manda este WhatsApp al instante (capta el momento aunque
                no estés). Solo se envía UNA vez por contacto y nunca a quien pide baja. Usa <code>{"{{nombre}}"}</code> para su nombre.
              </p>
              <textarea
                value={s.autoReplyText ?? ""}
                onChange={(e) => setField("autoReplyText", e.target.value)}
                rows={2}
                disabled={!s.autoReplyEnabled}
                placeholder="¡Hola {{nombre}}! Gracias por escribir 🙌 Te atiendo enseguida."
                className="mt-1.5 w-full px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-50"
              />
            </div>
            <div className="mt-2 rounded-lg border bg-indigo-50/50 p-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!s.autoFollowupEnabled}
                  onChange={(e) => setField("autoFollowupEnabled", e.target.checked)}
                  className="accent-indigo-600"
                />
                🤖 Auto-piloto de seguimiento (ningún lead caliente se enfría)
              </label>
              <p className="text-[11px] text-slate-500 mt-1">
                Si un lead caliente se queda en silencio tras tu última respuesta, la IA le manda sola un follow-up suave
                con cadencia decreciente (24h → 72h → 7 días, máx 3 toques). Se detiene en cuanto el lead responde o pide
                baja, respeta tu ventana horaria y el anti-baneo. Puedes desactivarlo por conversación desde su chat.
              </p>
            </div>
            <div className="mt-2 rounded-lg border bg-slate-50/60 p-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!s.followupTaskEnabled}
                  onChange={(e) => setField("followupTaskEnabled", e.target.checked)}
                  className="accent-indigo-600"
                />
                📋 Crear tarea de seguimiento al detectar un lead interesado
              </label>
              <p className="text-[11px] text-slate-500 mt-1">
                Cuando un lead responde interesado, crea una tarea en el proyecto «Seguimiento de leads» con recordatorio.
                <b> Desactivado por defecto</b> (para no llenar la columna). Actívalo cuando quieras volver a generarlas.
              </p>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("¿Mover a la papelera las tareas 'Seguir lead interesado' y borrar sus eventos en Google Calendar? Las tareas son recuperables 30 días.")) return;
                  let deleted = 0;
                  let purged = 0;
                  // Repite por lotes hasta que no queden espejos en Google.
                  for (let i = 0; i < 40; i++) {
                    const r = await fetch("/api/v1/leads/cleanup-followup-tasks", { method: "POST" });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok) { alert("Error: " + (j?.error?.message ?? r.status)); return; }
                    deleted += j.deleted ?? 0;
                    purged += j.purgedFromGoogle ?? 0;
                    if ((j.remaining ?? 0) <= 0) break;
                  }
                  alert(`✅ ${deleted} tareas a la papelera · ${purged} eventos borrados de Google Calendar.`);
                }}
                className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
              >
                🧹 Limpiar las tareas de seguimiento ya creadas
              </button>
            </div>
            <div className="mt-2 rounded-lg border bg-slate-50/60 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700">📲 Multi-número (reparto de envíos)</label>
                <button
                  type="button"
                  onClick={() => setField("channels", [...(s.channels ?? []), { name: "", label: "", dailyLimit: 50, active: true }])}
                  className="text-xs px-2 py-1 rounded border bg-white hover:bg-slate-50"
                >
                  + Añadir número
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mb-2">
                Reparte los envíos entre varias {s.whatsappProvider === "evolution" ? "instancias" : "sesiones"} de WhatsApp (más volumen sin quemar un número). Con 0 ó 1 número se usa el de arriba. Cada número escanea su propio WhatsApp en {s.whatsappProvider === "evolution" ? "Evolution" : "WAHA"} con ese nombre.
              </p>
              {/* Fila del número PRINCIPAL (default): siempre visible, con su estado
                  de conexión y botón para reconectar, igual que los canales extra. */}
              <div className="flex flex-wrap items-center gap-1.5 mb-2 pb-2 border-b border-slate-200">
                <span className="flex-1 min-w-[110px] px-2 py-1 rounded border bg-slate-50 text-xs font-semibold text-slate-700">
                  Principal <span className="font-mono font-normal text-slate-500">({s.wahaSession ?? "default"})</span>
                </span>
                {chanBadge(s.wahaSession ?? "default")}
                <button
                  type="button"
                  onClick={reconnectWaha}
                  disabled={reconnecting}
                  className="shrink-0 px-2 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs disabled:opacity-40"
                  title="Reconectar el número principal (default): reinicia la sesión y, si hace falta, muestra el QR más abajo."
                >
                  📷 Conectar
                </button>
                <button
                  type="button"
                  onClick={() => void resetWahaSession()}
                  disabled={reconnecting}
                  className="shrink-0 px-2 py-1 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs disabled:opacity-40"
                  title="Reinicio TOTAL: borra y recrea la sesión en WAHA para desatascarla cuando se queda clavada en STARTING o en FAILED. Tendrás que reescanear el QR."
                >
                  🧹 Reinicio total
                </button>
                <button
                  type="button"
                  onClick={() => void resetWahaSession(undefined, true)}
                  disabled={reconnecting}
                  className="shrink-0 px-2 py-1 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs disabled:opacity-40"
                  title="Reinicio total SIN proxy: recrea la sesión sin proxy. Si con esto SÍ aparece el QR, el problema era el proxy (DataImpulse) colgando el arranque."
                >
                  🧹 Sin proxy
                </button>
              </div>
              {(s.channels ?? []).length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">Sin números extra.</p>
              ) : (
                <div className="space-y-1.5">
                  {(s.channels ?? []).map((c: any, i: number) => (
                    <div key={i} className="space-y-1 border-b border-slate-100 pb-2 last:border-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        value={c.name ?? ""}
                        onChange={(e) => updateChannel(i, { name: sanitizeSessionName(e.target.value) })}
                        placeholder={s.whatsappProvider === "evolution" ? "instancia" : "sesión (sin espacios ni tildes)"}
                        title="Nombre técnico de la sesión: solo letras, números, guion y guion bajo (sin espacios ni tildes). La descripción (p. ej. 'centro málaga') va en la ETIQUETA de al lado."
                        className="flex-1 min-w-[110px] px-2 py-1 rounded border bg-white text-xs font-mono"
                      />
                      <input
                        value={c.label ?? ""}
                        onChange={(e) => updateChannel(i, { label: e.target.value })}
                        placeholder="etiqueta (opcional)"
                        className="flex-1 min-w-[100px] px-2 py-1 rounded border bg-white text-xs"
                      />
                      <input
                        type="number"
                        value={c.dailyLimit ?? 50}
                        onChange={(e) => updateChannel(i, { dailyLimit: Number(e.target.value) || 50 })}
                        title="Tope diario de este número"
                        className="w-16 px-2 py-1 rounded border bg-white text-xs"
                      />
                      <input
                        value={c.phone ?? ""}
                        onChange={(e) => updateChannel(i, { phone: e.target.value })}
                        placeholder="+34600…"
                        title="Número de WhatsApp de este teléfono (para el calentamiento por conversación)"
                        className="w-28 min-w-0 px-2 py-1 rounded border bg-white text-xs font-mono"
                      />
                      {chanBadge(c.name)}
                      <button
                        type="button"
                        title={c.active === false ? "Reactivar este número: vuelve a entrar en el reparto de envíos." : "Jubilar este número: lo saca del reparto (deja de enviar) pero conserva su historial y calentamiento. Úsalo con los quemados en vez de borrarlos."}
                        onClick={() => updateChannel(i, { active: c.active === false })}
                        className={`shrink-0 text-[10px] px-1.5 py-1 rounded border ${c.active === false ? "border-slate-300 bg-slate-100 text-slate-500" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                      >
                        {c.active === false ? "💤 jubilado" : "✅ en uso"}
                      </button>
                      <button
                        type="button"
                        title="Reiniciar calentamiento: trata este número como nuevo/frágil (recién recuperado de un baneo) y limita sus envíos en rampa unos días."
                        onClick={() => updateChannel(i, { warmupSince: new Date().toISOString() })}
                        className={`shrink-0 text-[10px] px-1.5 py-1 rounded border ${c.warmupSince ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
                      >
                        {c.warmupSince ? "🔥 calentando" : "🔥 reiniciar"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!c.name?.trim()) return;
                          // Si se está cerrando el QR, no hace falta guardar.
                          if (channelQr === c.name) { setChannelQr(null); return; }
                          // Guardar SIEMPRE antes de pedir el QR: el endpoint exige
                          // que el número esté dado de alta en Ajustes. Evita el
                          // error "no está en Ajustes".
                          const ok = await save();
                          if (!ok) return;
                          setChannelQrErr(null);
                          setChannelQrNonce((n) => n + 1);
                          setChannelQr(c.name);
                        }}
                        disabled={!c.name?.trim() || saving}
                        className="px-2 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs disabled:opacity-40"
                        title="Conectar este número: escanea su QR con el móvil de la SIM (solo una vez). Guarda los ajustes antes."
                      >
                        📷 Conectar
                      </button>
                      <button
                        type="button"
                        onClick={() => void resetWahaSession(c.name)}
                        disabled={!c.name?.trim() || saving || reconnecting}
                        className="px-2 py-1 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs disabled:opacity-40"
                        title="Reinicio TOTAL de este número: borra y recrea su sesión en WAHA para desatascarla. Tendrás que reescanear el QR."
                      >
                        🧹 Reinicio
                      </button>
                      <button
                        type="button"
                        onClick={() => removeChannel(i)}
                        className="px-2 py-1 rounded border bg-white hover:bg-rose-50 text-rose-600 text-xs"
                        title="Quitar"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={c.proxy ?? ""}
                        onChange={(e) => updateChannel(i, { proxy: e.target.value })}
                        placeholder="proxy sticky de ESTE número — ej. http://LOGIN__cr.es;sessid.1:PASS@gw.dataimpulse.com:10000"
                        title="Proxy por el que sale este número a internet. Anti-baneo: cada número con su propia IP residencial/móvil, no la del servidor (datacenter)."
                        className="flex-1 min-w-0 px-2 py-1 rounded border bg-white text-[11px] font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => testProxy(c.name || `#${i}`, c.proxy ?? "")}
                        disabled={!((c.proxy ?? "").trim()) || proxyTest[c.name || `#${i}`]?.loading}
                        className="shrink-0 px-2 py-1 rounded border bg-white hover:bg-indigo-50 text-indigo-700 text-[11px] disabled:opacity-40"
                        title="Verifica que el proxy funciona y muestra la IP de salida"
                      >
                        Probar
                      </button>
                    </div>
                    <div>{proxyStatusView(c.name || `#${i}`)}</div>
                    </div>
                  ))}
                </div>
              )}
              {channelQr && (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-center">
                  <p className="text-xs font-semibold text-emerald-800 mb-2">
                    Vincular el número "{channelQr}" — abre WhatsApp en el móvil de esa SIM →
                    Dispositivos vinculados → Vincular dispositivo, y escanea:
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/v1/leads/waha-qr?session=${encodeURIComponent(channelQr)}&n=${channelQrNonce}`}
                    alt={`QR para vincular ${channelQr}`}
                    className="mx-auto w-52 h-52 bg-white rounded border"
                    onError={async () => {
                      try {
                        const r = await fetch(`/api/v1/leads/waha-qr?session=${encodeURIComponent(channelQr)}&n=${channelQrNonce}`);
                        const j = await r.json().catch(() => null);
                        setChannelQrErr(j?.message ?? "QR no disponible aún; guarda los ajustes y pulsa Actualizar.");
                      } catch {
                        setChannelQrErr("QR no disponible aún; guarda los ajustes y pulsa Actualizar.");
                      }
                    }}
                  />
                  {channelQrErr && <p className="text-[11px] text-amber-700 mt-1.5">{channelQrErr}</p>}
                  <div className="mt-2 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setChannelQrErr(null); setChannelQrNonce((n) => n + 1); }}
                      className="px-2.5 py-1 rounded border bg-white hover:bg-slate-50 text-xs"
                    >
                      🔄 Actualizar QR
                    </button>
                    <button
                      type="button"
                      onClick={() => setChannelQr(null)}
                      className="px-2.5 py-1 rounded border bg-white hover:bg-slate-50 text-xs"
                    >
                      Cerrar
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">
                    Una vez vinculado, el número envía desde el servidor: la SIM puede quedarse guardada
                    (conecta su móvil a internet al menos una vez cada ~14 días para que no caduque).
                  </p>
                </div>
              )}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={loadHealth}
                  disabled={loadingHealth}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded border bg-white hover:bg-slate-50 text-xs disabled:opacity-50"
                >
                  {loadingHealth && <Loader2 className="h-3 w-3 animate-spin" />}
                  Ver salud de los números
                </button>
                {health && (
                  <div className="mt-2 overflow-x-auto">
                    {health.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">Sin datos de envío todavía.</p>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead className="text-slate-500">
                          <tr className="text-left">
                            <th className="py-1 pr-2">Número</th>
                            <th className="py-1 pr-2">Hoy</th>
                            <th className="py-1 pr-2">7d ok</th>
                            <th className="py-1 pr-2">Leídos 7d</th>
                            <th className="py-1 pr-2">Resp 7d</th>
                            <th className="py-1 pr-2">Fallos 7d</th>
                            <th className="py-1 pr-2">Riesgo</th>
                            <th className="py-1 pr-2">IP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {health.map((h, i) => {
                            const burning = h.sent7 > 0 && h.failed7 / (h.sent7 + h.failed7) > 0.3;
                            const riskCls = h.riskLabel === "alto" ? "bg-rose-100 text-rose-700" : h.riskLabel === "medio" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
                            return (
                              <tr key={i} className="border-t">
                                <td className="py-1 pr-2 font-mono">{h.label ? `${h.label} (${h.name ?? "—"})` : h.name ?? "Por defecto"}</td>
                                <td className="py-1 pr-2">{h.sentToday}</td>
                                <td className="py-1 pr-2">{h.sent7}</td>
                                <td className="py-1 pr-2">{h.read7}</td>
                                <td className={"py-1 pr-2 " + (h.sent7 >= 30 && (h.replies7 ?? 0) === 0 ? "text-amber-600 font-semibold" : "")}>{h.replies7 ?? "—"}</td>
                                <td className={"py-1 pr-2 " + (burning ? "text-rose-600 font-semibold" : "")}>
                                  {h.failed7}{burning ? " ⚠" : ""}
                                </td>
                                <td className="py-1 pr-2">
                                  {h.riskLabel ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${riskCls}`} title={`Riesgo ${h.risk}/100${h.ageDays != null ? ` · ${h.ageDays}d de vida` : ""}`}>
                                      {h.riskLabel} {h.risk}
                                    </span>
                                  ) : "—"}
                                </td>
                                <td className="py-1 pr-2 font-mono text-[10px] text-slate-500">{h.exitIp ?? (h.hasProxy ? "?" : "sin proxy")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
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
                title="Configura el webhook del proveedor para que esta app reciba los mensajes entrantes en el Inbox"
              >
                {webhookSetting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Configurar webhook en {s.whatsappProvider === "evolution" ? "Evolution" : "WAHA"}
              </button>
              <span className="text-[11px] text-slate-400">Comprueba la sesión y, si los leads responden pero no aparecen en Inbox, pulsa "Configurar webhook".</span>
            </div>
            {webhookSetupResult && (
              <div className={`text-xs rounded-lg border p-2.5 ${webhookSetupResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                {webhookSetupResult.ok
                  ? `✓ Webhook configurado en ${s.whatsappProvider === "evolution" ? "Evolution" : "WAHA"} (${webhookSetupResult.url}). A partir de ahora los mensajes entrantes llegarán al Inbox.`
                  : `✗ ${webhookSetupResult.error ?? "No se pudo configurar"}`}
              </div>
            )}
            {wahaTest && (
              <div className={`text-xs rounded-lg border p-2.5 ${wahaTest.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                <div className="font-medium">{wahaTest.ok ? "✓ Conectado" : "✗ No conectado"}</div>
                <div className="mt-0.5">{wahaTest.message}</div>
                {wahaTest.url && (
                  <div className="mt-1 text-[11px] opacity-80">
                    🖥️ Servidor WAHA: <span className="font-mono break-all">{wahaTest.url}</span>
                  </div>
                )}
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
            <label>Daily limit <input type="number" value={s.dailyLimit ?? 60} onChange={(e) => setField("dailyLimit", Number(e.target.value))} className="w-full px-2 py-1 rounded border" /></label>
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
              <input type="number" value={s.maxNewChatsPerDay ?? 10} onChange={(e) => setField("maxNewChatsPerDay", Number(e.target.value))} className="w-full px-2 py-1 rounded border" />
            </label>
          </div>
          <label className="mt-2 flex items-start gap-2 cursor-pointer p-2 rounded-lg border bg-amber-50/50 border-amber-200">
            <input
              type="checkbox"
              checked={s.blockLinksInFirstMessage ?? true}
              onChange={(e) => setField("blockLinksInFirstMessage", e.target.checked)}
              className="mt-0.5 accent-amber-600"
            />
            <div className="flex-1 text-xs text-amber-900">
              <strong className="block text-sm">🔗 Bloquear enlaces en el primer mensaje</strong>
              <p className="mt-1">
                No envía el <strong>primer</strong> mensaje a un número si lleva un link (un enlace en el
                opener en frío es de los mayores disparadores de la marca de spam). El mensaje queda como
                <code> blocked_link</code> —no se envía ni cuenta como fallo— para que quites el link del opener
                y lo mandes tras la primera respuesta del lead. Recomendado dejarlo activado.
              </p>
            </div>
          </label>
          <label className="mt-2 flex items-start gap-2 cursor-pointer p-2 rounded-lg border bg-amber-50/50 border-amber-200">
            <input
              type="checkbox"
              checked={s.replyRateGuardEnabled ?? false}
              onChange={(e) => setField("replyRateGuardEnabled", e.target.checked)}
              className="mt-0.5 accent-amber-600"
            />
            <div className="flex-1 text-xs text-amber-900">
              <strong className="block text-sm">📉 Apartar números que no reciben respuestas</strong>
              <p className="mt-1">
                Si un número manda mucho (≥40 en 7 días) y <strong>no recibe NINGUNA respuesta</strong>, se
                marca como <em>degradado</em> y el reparto prioriza los demás (nunca se cuarentena por esto, para
                no apartar números sanos por error). <strong>Opt-in</strong>: actívalo solo cuando confirmes que
                las respuestas entrantes se atribuyen bien a cada número (mira la columna “respuestas” en el
                panel de salud). Por eso viene desactivado por defecto.
              </p>
            </div>
          </label>
          <div className="mt-3 p-3 rounded-lg border bg-indigo-50/50 border-indigo-200 space-y-2">
            <strong className="block text-sm text-indigo-900">🛡 Proxy / IP de salida por número (anti-baneo clave)</strong>
            {Object.entries(s.proxyStatus ?? {}).filter(([, v]: any) => v && v.ok === false).length > 0 && (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-[11px] text-rose-800">
                <strong>⚠️ Proxy caído:</strong>{" "}
                {Object.entries(s.proxyStatus ?? {})
                  .filter(([, v]: any) => v && v.ok === false)
                  .map(([k]) => (k === "__global__" ? "global" : k))
                  .join(", ")}
                . Revisa la IP/credenciales; mientras esté caído, ese número no puede enviar por su proxy.
              </div>
            )}
            <p className="text-[11px] text-indigo-800">
              La causa nº1 de baneo rápido no es solo el volumen: es que todos los números salgan por la MISMA IP del servidor (datacenter). WhatsApp penaliza fuerte las IPs de datacenter y el compartir IP entre números. Lo ideal: <strong>cada número con su propio proxy residencial/móvil</strong> (IP fija/sticky). Formato: <code>http://usuario:clave@host:puerto</code> (o <code>socks5://…</code>).
            </p>
            <p className="text-[11px] text-indigo-800">
              Para WhatsApp basta un <strong>residencial de pago por GB</strong> (gasta céntimos: el texto usa muy pocos datos); el móvil dedicado es caro e innecesario. Con <strong>DataImpulse</strong>, activa el modo <strong>“Pegajoso” (Session Interval 0)</strong> — el puerto pasa a <strong>10000</strong> — y pon un <code>sessid</code> distinto por número, con España (<code>__cr.es</code>):<br />
              <code>http://LOGIN__cr.es;sessid.1:PASS@gw.dataimpulse.com:10000</code> (nº 1), <code>…;sessid.2…:10000</code> (nº 2)… El <code>sessid</code> solo en el puerto rotatorio 823 mantiene la IP ~30 min; el modo Pegajoso (10000) la fija mucho más.
            </p>
            <label className="block text-xs text-indigo-900">
              Proxy global por defecto (para el número principal y los canales sin proxy propio)
              <div className="flex gap-1.5 mt-0.5">
                <input
                  value={s.wahaProxy ?? ""}
                  onChange={(e) => setField("wahaProxy", e.target.value)}
                  placeholder="http://usuario:clave@host:puerto — vacío = sale por la IP del servidor"
                  className="flex-1 min-w-0 px-2 py-1 rounded border font-mono"
                />
                <button
                  type="button"
                  onClick={() => testProxy("__global__", s.wahaProxy ?? "")}
                  disabled={!((s.wahaProxy ?? "").trim()) || proxyTest["__global__"]?.loading}
                  className="shrink-0 px-2 py-1 rounded border bg-white hover:bg-indigo-50 text-indigo-700 text-xs disabled:opacity-40"
                  title="Verifica que el proxy funciona y muestra la IP de salida"
                >
                  Probar
                </button>
              </div>
            </label>
            <div>{proxyStatusView("__global__")}</div>
            <p className="text-[11px] text-indigo-700">
              El proxy de cada canal (arriba, bajo cada número) tiene prioridad sobre este global. Al cambiar un proxy, <strong>reconecta ese número (reescanea su QR)</strong> para que la sesión salga por la nueva IP.
            </p>
          </div>
          <div className="mt-3 p-3 rounded-lg border bg-emerald-50/40 border-emerald-200 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={s.warmupEnabled ?? true}
                onChange={(e) => setField("warmupEnabled", e.target.checked)}
                className="mt-0.5 accent-emerald-600"
              />
              <div className="flex-1 text-xs text-emerald-900">
                <strong className="block text-sm">🔥 Calentamiento de número nuevo (warmup)</strong>
                <p className="mt-1">
                  El tope diario sube en rampa durante los primeros días en vez de empezar al máximo
                  (clave para no quemar un número nuevo). <strong>Por teléfono</strong>: cada número calienta
                  desde su propia fecha de alta, así uno nuevo no envía a tope aunque la cuenta sea antigua.
                </p>
              </div>
            </label>
            {(s.warmupEnabled ?? true) && (
              <div className="grid grid-cols-2 gap-2 text-xs pl-6">
                <label>Días de rampa
                  <input type="number" value={s.warmupDays ?? 45} onChange={(e) => setField("warmupDays", Number(e.target.value))} className="w-full px-2 py-1 rounded border" />
                </label>
                <label>Tope del primer día
                  <input type="number" value={s.warmupStartCap ?? 3} onChange={(e) => setField("warmupStartCap", Number(e.target.value))} className="w-full px-2 py-1 rounded border" />
                </label>
              </div>
            )}
            <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-emerald-200">
              <input
                type="checkbox"
                checked={s.autoRecoveryEnabled ?? true}
                onChange={(e) => setField("autoRecoveryEnabled", e.target.checked)}
                className="mt-0.5 accent-emerald-600"
              />
              <div className="flex-1 text-xs text-emerald-900">
                <strong className="block text-sm">🛟 Auto-recuperación ante pico de fallos</strong>
                <p className="mt-1">
                  Si muchos envíos seguidos fallan (señal típica de restricción), activa solo el modo
                  recuperación para frenar y proteger el número.
                </p>
              </div>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-emerald-200" title="Varía el tope diario un % aleatorio cada día para que el volumen no sea idéntico (patrón de bot).">
              <span className="text-emerald-900">Variación diaria del tope (jitter %)</span>
              <input
                type="number"
                value={Math.round((s.dailyJitterPct ?? 0.15) * 100)}
                onChange={(e) => setField("dailyJitterPct", Math.max(0, Math.min(50, Number(e.target.value))) / 100)}
                className="w-20 px-2 py-1 rounded border"
              />
            </label>
          </div>
          <div className="mt-3 p-3 rounded-lg border bg-amber-50/40 border-amber-200 text-amber-900">
            <strong className="block text-sm">🛡 Modo recuperación por teléfono</strong>
            <p className="mt-1 text-xs">
              Actívalo solo en el número restringido. Durante {s.recoveryDurationDays ?? 14} días ese teléfono queda en
              15/día, 3/hora, 8 conversaciones nuevas/día, delay de 5-15 min y cool-down de 10 días. Los demás números
              mantienen sus límites normales.
            </p>
            {s.recoveryMode && (
              <label className="mt-2 flex items-center gap-2 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
                <input
                  type="checkbox"
                  checked={!!s.recoveryMode}
                  onChange={(e) => setField("recoveryMode", e.target.checked)}
                  className="accent-rose-600"
                />
                Modo global antiguo activo: desmárcalo para que dejen de verse afectados todos los teléfonos.
              </label>
            )}
            <div className="mt-2 space-y-1.5">
              {[
                { key: "__principal__", label: `Principal (${s.wahaSession ?? "default"})`, phone: s.principalPhone },
                ...(s.channels ?? []).map((channel: any) => ({
                  key: channel.name,
                  label: channel.label || channel.name,
                  phone: channel.phone
                }))
              ].filter((channel: any) => channel.key).map((channel: any) => {
                const state = s.recoveryByChannel?.[channel.key];
                const active = !!state?.enabled;
                const durationDays = state?.durationDays ?? 14;
                const expiresAt = state?.since
                  ? new Date(new Date(state.since).getTime() + durationDays * 86_400_000)
                  : null;
                return (
                  <label
                    key={channel.key}
                    className={`flex items-center gap-2 rounded border px-2.5 py-2 text-xs cursor-pointer ${
                      active ? "border-rose-300 bg-rose-50 text-rose-900" : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setField("recoveryByChannel", {
                        ...(s.recoveryByChannel ?? {}),
                        [channel.key]: {
                          enabled: e.target.checked,
                          since: active ? state?.since ?? null : null,
                          durationDays
                        }
                      })}
                      className="accent-rose-600"
                    />
                    <span className="min-w-0 flex-1">
                      <b>{channel.label}</b>{channel.phone ? <span className="ml-1 font-mono text-slate-500">{channel.phone}</span> : null}
                    </span>
                    <span className={active ? "text-rose-700" : "text-slate-400"}>
                      {active && expiresAt ? `hasta ${expiresAt.toLocaleDateString("es-ES")}` : active ? "recuperación activa" : "límites normales"}
                    </span>
                  </label>
                );
              })}
            </div>
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
