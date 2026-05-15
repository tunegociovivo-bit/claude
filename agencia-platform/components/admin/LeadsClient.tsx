"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import {
  Loader2, Plus, Search, Inbox, ListChecks, BarChart3, MessageCircle,
  Settings as SettingsIcon, Ban, GitBranch, Send, RefreshCw, Download, Play, Pause, Trash2
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

type Tab = "leads" | "searches" | "queue" | "inbox" | "sequences" | "templates" | "exclusions" | "analytics" | "settings";

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
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState("ALL");
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
        if (searchQ) q.set("search", searchQ);
        const r = await fetch(`/api/v1/leads?${q.toString()}`);
        if (r.ok) setLeads((await r.json()).items ?? []);
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
        if (r.ok) setInbox((await r.json()).items ?? []);
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
  }, [tab, statusFilter, urgencyFilter, searchQ]);

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

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 mb-4 bg-white border rounded-lg p-1">
        <TabBtn icon={<BarChart3 className="h-3.5 w-3.5" />} label="Leads" active={tab === "leads"} onClick={() => setTab("leads")} />
        <TabBtn icon={<Search className="h-3.5 w-3.5" />} label="Búsquedas" active={tab === "searches"} onClick={() => setTab("searches")} />
        <TabBtn icon={<Send className="h-3.5 w-3.5" />} label="Cola envío" active={tab === "queue"} onClick={() => setTab("queue")} />
        <TabBtn icon={<Inbox className="h-3.5 w-3.5" />} label="Inbox" active={tab === "inbox"} onClick={() => setTab("inbox")} />
        <TabBtn icon={<GitBranch className="h-3.5 w-3.5" />} label="Secuencias" active={tab === "sequences"} onClick={() => setTab("sequences")} />
        <TabBtn icon={<ListChecks className="h-3.5 w-3.5" />} label="Plantillas" active={tab === "templates"} onClick={() => setTab("templates")} />
        <TabBtn icon={<Ban className="h-3.5 w-3.5" />} label="Exclusiones" active={tab === "exclusions"} onClick={() => setTab("exclusions")} />
        <TabBtn icon={<BarChart3 className="h-3.5 w-3.5" />} label="Analytics" active={tab === "analytics"} onClick={() => setTab("analytics")} />
      </div>

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
            <a
              href="/api/v1/leads/export"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
          <LeadsTable loading={loading} items={leads} />
        </>
      )}

      {tab === "searches" && <SearchesTable loading={loading} items={searches} onChanged={load} />}
      {tab === "queue" && <QueueTable loading={loading} items={queue} onChanged={load} />}
      {tab === "inbox" && <InboxList loading={loading} items={inbox} />}
      {tab === "sequences" && <SequencesView />}
      {tab === "templates" && <TemplatesTable loading={loading} items={templates} onChanged={load} />}
      {tab === "exclusions" && <ExclusionsView />}
      {tab === "analytics" && <AnalyticsView data={analytics} loading={loading} />}

      <NewSearchModal open={newSearchOpen} onClose={() => setNewSearchOpen(false)} onSaved={load} />
      <NewTemplateModal open={newTemplateOpen} onClose={() => setNewTemplateOpen(false)} onSaved={load} />
      <LeadsSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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

// ============ LEADS ============

function LeadsTable({ loading, items }: { loading: boolean; items: Lead[] }) {
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin leads. Crea una búsqueda para captar." />;
  return (
    <div className="bg-white rounded-xl border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-3 py-2.5">Negocio</th>
            <th className="text-left px-3 py-2.5">Provincia</th>
            <th className="text-left px-3 py-2.5">Teléfono</th>
            <th className="text-left px-3 py-2.5">Pos</th>
            <th className="text-left px-3 py-2.5">Rating</th>
            <th className="text-left px-3 py-2.5">Score</th>
            <th className="text-left px-3 py-2.5">Urgencia</th>
            <th className="text-left px-3 py-2.5">WA</th>
            <th className="text-left px-3 py-2.5">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((l) => {
            const st = CONTACT_STATUSES.find((s) => s.value === l.contactStatus) ?? CONTACT_STATUSES[0];
            const urg = l.urgency ? URGENCY_COLORS[l.urgency] : "";
            return (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 max-w-xs truncate font-medium" title={l.name}>{l.name}</td>
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
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${st.color}`}>{st.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============ BÚSQUEDAS ============

function SearchesTable({ loading, items, onChanged }: { loading: boolean; items: SearchRow[]; onChanged: () => void }) {
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin búsquedas. Pulsa 'Nueva búsqueda' arriba." />;
  async function process(id: string) {
    await fetch(`/api/v1/leads/searches/${id}/process`, { method: "POST" });
    onChanged();
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
                <td className="px-3 py-2 text-xs">{s.status}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {pending && (
                    <button
                      onClick={() => process(s.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-xs"
                    >
                      <Play className="h-3 w-3" />
                      Procesar batch
                    </button>
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
  async function tick() {
    setProcessing(true);
    await fetch("/api/v1/leads/queue/process", { method: "POST" });
    setProcessing(false);
    onChanged();
  }
  if (loading) return <Loading />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={tick}
          disabled={processing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-xs disabled:opacity-50"
        >
          {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Procesar siguiente
        </button>
        <span className="text-xs text-slate-500">{items.length} mensajes en cola/historial</span>
      </div>
      {items.length === 0 ? (
        <Empty msg="Sin mensajes. Encola algo desde el detalle de un lead." />
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2.5">Teléfono</th>
                <th className="text-left px-3 py-2.5">Mensaje</th>
                <th className="text-left px-3 py-2.5">Programado</th>
                <th className="text-left px-3 py-2.5">Estado</th>
                <th className="text-left px-3 py-2.5">Intentos</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{m.phoneNormalized}</td>
                  <td className="px-3 py-2 text-xs max-w-md truncate" title={m.renderedMessage}>{m.renderedMessage}</td>
                  <td className="px-3 py-2 text-xs">
                    {m.scheduledAt ? new Date(m.scheduledAt).toLocaleString("es-ES") : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{m.status}</td>
                  <td className="px-3 py-2 text-xs">{m.sendAttempts}{m.lastError && ` ⚠ ${m.lastError.slice(0, 40)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ INBOX ============

function InboxList({ loading, items }: { loading: boolean; items: InboxRow[] }) {
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin mensajes recibidos. Configura el webhook de WAHA en Ajustes." />;
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
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin plantillas. Crea la primera." />;
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {items.map((t) => (
        <div key={t.id} className="bg-white rounded-lg border p-3">
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="font-semibold text-sm">{t.name}</h3>
            <div className="flex gap-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{t.channel}</span>
              {t.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">default</span>}
            </div>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{t.body}</pre>
        </div>
      ))}
    </div>
  );
}

// ============ SECUENCIAS ============

function SequencesView() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    fetch("/api/v1/leads/sequences")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="Sin secuencias. Endpoint /api/v1/leads/sequences GET disponible (la UI de creación está en roadmap)." />;
  return (
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
          <div className="text-xs text-slate-500">{s.steps?.length ?? 0} pasos</div>
        </div>
      ))}
    </div>
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

function NewSearchModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [scope, setScope] = useState<"custom" | "spain">("custom");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setLocation("");
    setScope("custom");
    setError(null);
    setSaving(false);
  }, [open]);
  async function save() {
    if (!keyword.trim()) { setError("Falta el keyword"); return; }
    if (scope === "custom" && !location.trim()) { setError("Falta la localidad"); return; }
    setSaving(true);
    setError(null);
    const r = await fetch("/api/v1/leads/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, location, scope })
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
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Keyword (ej: plomero, dentista, abogado)"
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
        />
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Alcance</label>
          <div className="grid grid-cols-2 gap-2">
            <label className={"flex items-center gap-2 p-2 rounded border cursor-pointer " + (scope === "custom" ? "bg-brand-50 border-brand-300" : "bg-white")}>
              <input type="radio" checked={scope === "custom"} onChange={() => setScope("custom")} className="accent-brand-600" />
              <span className="text-xs">Una provincia / localidad</span>
            </label>
            <label className={"flex items-center gap-2 p-2 rounded border cursor-pointer " + (scope === "spain" ? "bg-brand-50 border-brand-300" : "bg-white")}>
              <input type="radio" checked={scope === "spain"} onChange={() => setScope("spain")} className="accent-brand-600" />
              <span className="text-xs">Toda España (52 provincias)</span>
            </label>
          </div>
        </div>
        {scope === "custom" && (
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Provincia o localidad (ej: Málaga, Madrid)"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
          />
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

function NewTemplateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(""); setBody(""); setIsDefault(false); setError(null);
  }, [open]);
  async function save() {
    if (!name.trim() || !body.trim()) { setError("Faltan nombre y cuerpo"); return; }
    setSaving(true);
    const r = await fetch("/api/v1/leads/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, body, channel: "whatsapp", isDefault })
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
    <Modal open={open} onClose={onClose} title="Nueva plantilla" size="md" footer={
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
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setGoogleKey(""); setWahaKey(""); setError(null); setSavedAt(null);
    fetch("/api/v1/leads/settings").then((r) => r.ok ? r.json() : null).then(setS);
  }, [open]);
  if (!s) return <Modal open={open} onClose={onClose} title="Ajustes leads" size="lg"><Loading /></Modal>;
  async function save() {
    setSaving(true);
    setError(null);
    const body: any = {
      wahaUrl: s.wahaUrl,
      wahaSession: s.wahaSession,
      whatsappCountryCode: s.whatsappCountryCode,
      sendEnabled: s.sendEnabled,
      sendPaused: s.sendPaused,
      sendWindowStart: s.sendWindowStart,
      sendWindowEnd: s.sendWindowEnd,
      sendDelayMinSec: s.sendDelayMinSec,
      sendDelayMaxSec: s.sendDelayMaxSec,
      sendOnWeekends: s.sendOnWeekends,
      dailyLimit: s.dailyLimit,
      enableVariations: s.enableVariations,
      maxAttempts: s.maxAttempts
    };
    if (googleKey) body.googleApiKey = googleKey;
    if (wahaKey) body.wahaApiKey = wahaKey;
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
          <h3 className="text-sm font-semibold mb-2">📱 WhatsApp (WAHA)</h3>
          <div className="space-y-2">
            <input value={s.wahaUrl ?? ""} onChange={(e) => setField("wahaUrl", e.target.value)} placeholder="https://waha.ejemplo.com" className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
            <input type="password" value={wahaKey} onChange={(e) => setWahaKey(e.target.value)} placeholder={s.wahaConfigured ? "•••• (configurada)" : "API key WAHA"} className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <input value={s.wahaSession ?? "default"} onChange={(e) => setField("wahaSession", e.target.value)} placeholder="Nombre sesión" className="px-3 py-2 rounded-lg border bg-white text-sm" />
              <input value={s.whatsappCountryCode ?? "34"} onChange={(e) => setField("whatsappCountryCode", e.target.value)} placeholder="Código país (34)" className="px-3 py-2 rounded-lg border bg-white text-sm" />
            </div>
            <div className="text-[11px] text-slate-500 break-all">
              Webhook URL: <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/v1/leads/webhook/{s.webhookToken}</code>
            </div>
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
          </div>
        </section>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {savedAt && <p className="text-xs text-emerald-700">Guardado a las {savedAt.toLocaleTimeString("es-ES")}.</p>}
      </div>
    </Modal>
  );
}
