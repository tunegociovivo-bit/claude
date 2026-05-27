"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
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
  }, [tab, statusFilter, urgencyFilter, searchIdFilter, searchQ]);

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
      {tab === "inbox" && <InboxList loading={loading} items={inbox} />}
      {tab === "sequences" && <SequencesView />}
      {tab === "templates" && <TemplatesTable loading={loading} items={templates} onChanged={load} />}
      {tab === "exclusions" && <ExclusionsView />}
      {tab === "analytics" && <AnalyticsView data={analytics} loading={loading} />}

      <NewSearchModal open={newSearchOpen} onClose={() => setNewSearchOpen(false)} onSaved={load} />
      <TemplateModal open={newTemplateOpen} template={null} onClose={() => setNewTemplateOpen(false)} onSaved={load} />
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

function LeadsTable({ loading, items, onChanged }: { loading: boolean; items: Lead[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enqueueOpen, setEnqueueOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);

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
        <div className="flex items-center justify-between gap-2 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
          <span className="text-sm text-brand-800 font-medium">{selected.size} lead(s) seleccionados</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-600 hover:underline">
              Quitar selección
            </button>
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
    </div>
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
  const [reconnecting, setReconnecting] = useState(false);
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
            <div className="text-[11px] text-slate-500 break-all">
              Webhook URL: <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/v1/leads/webhook/{s.webhookToken}</code>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={testWaha}
                disabled={wahaTesting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium disabled:opacity-50"
              >
                {wahaTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Probar conexión
              </button>
              <span className="text-[11px] text-slate-400">Comprueba el servidor y la sesión sin enviar nada. Guarda antes si cambiaste algo.</span>
            </div>
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
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {savedAt && <p className="text-xs text-emerald-700">Guardado a las {savedAt.toLocaleTimeString("es-ES")}.</p>}
      </div>
    </Modal>
  );
}
