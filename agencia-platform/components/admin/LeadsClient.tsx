"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { Loader2, Plus, Search, Inbox, ListChecks, BarChart3, MessageCircle } from "lucide-react";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewsCount: number;
  score: number | null;
  contactStatus: string;
  aiOpener: string | null;
  hasWhatsapp: boolean;
};

type SearchRow = {
  id: string;
  keyword: string;
  location: string;
  status: string;
  totalResults: number;
  createdAt: string;
  _count: { leads: number };
};

type Template = { id: string; name: string; body: string; channel: string };

type InboxRow = {
  id: string;
  fromPhone: string;
  body: string;
  read: boolean;
  receivedAt: string;
  lead?: { id: string; name: string; phone: string | null } | null;
};

type Tab = "leads" | "searches" | "templates" | "inbox";

const CONTACT_STATUSES = [
  { value: "NEW", label: "Nuevo", color: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "QUEUED", label: "En cola", color: "bg-amber-100 text-amber-800 border-amber-200" },
  { value: "CONTACTED", label: "Contactado", color: "bg-sky-100 text-sky-800 border-sky-200" },
  { value: "REPLIED", label: "Respondió", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  { value: "CONVERTED", label: "Convertido", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { value: "LOST", label: "Perdido", color: "bg-rose-50 text-rose-700 border-rose-200" }
];

export default function LeadsClient() {
  const [tab, setTab] = useState<Tab>("leads");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQ, setSearchQ] = useState("");
  const [newSearchOpen, setNewSearchOpen] = useState(false);
  const [newTemplateOpen, setNewTemplateOpen] = useState(false);

  async function load() {
    setLoading(true);
    if (tab === "leads") {
      const q = new URLSearchParams();
      if (statusFilter !== "ALL") q.set("contactStatus", statusFilter);
      if (searchQ) q.set("search", searchQ);
      const r = await fetch(`/api/v1/leads?${q.toString()}`);
      if (r.ok) setLeads((await r.json()).items ?? []);
    } else if (tab === "searches") {
      const r = await fetch("/api/v1/leads/searches");
      if (r.ok) setSearches((await r.json()).items ?? []);
    } else if (tab === "templates") {
      const r = await fetch("/api/v1/leads/templates");
      if (r.ok) setTemplates((await r.json()).items ?? []);
    } else if (tab === "inbox") {
      const r = await fetch("/api/v1/leads/inbox");
      if (r.ok) setInbox((await r.json()).items ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [tab, statusFilter]);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Leads (NV Leads Pro)"
        description="Captación, scoring y secuencias de WhatsApp para leads de Google My Business."
        actions={
          tab === "searches" ? (
            <button
              onClick={() => setNewSearchOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Nueva búsqueda
            </button>
          ) : tab === "templates" ? (
            <button
              onClick={() => setNewTemplateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Nueva plantilla
            </button>
          ) : null
        }
      />

      <div className="flex gap-1 bg-white border rounded-xl p-1 mb-4 max-w-fit">
        <TabBtn icon={<BarChart3 className="h-3.5 w-3.5" />} label="Leads" active={tab === "leads"} onClick={() => setTab("leads")} />
        <TabBtn icon={<Search className="h-3.5 w-3.5" />} label="Búsquedas" active={tab === "searches"} onClick={() => setTab("searches")} />
        <TabBtn icon={<ListChecks className="h-3.5 w-3.5" />} label="Plantillas" active={tab === "templates"} onClick={() => setTab("templates")} />
        <TabBtn icon={<Inbox className="h-3.5 w-3.5" />} label="Inbox" active={tab === "inbox"} onClick={() => setTab("inbox")} />
      </div>

      {tab === "leads" && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs">
              <span className="text-slate-500">Estado:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent font-medium focus:outline-none"
              >
                <option value="ALL">Todos</option>
                {CONTACT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") load(); }}
              placeholder="Buscar nombre/teléfono/web…"
              className="px-3 py-1.5 rounded-lg border bg-white text-xs flex-1 max-w-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button onClick={load} className="px-2.5 py-1.5 rounded-lg bg-white border text-xs hover:bg-slate-50">
              Aplicar
            </button>
          </div>
          <DataTable loading={loading} items={leads} statuses={CONTACT_STATUSES} />
        </>
      )}

      {tab === "searches" && <SearchesTable loading={loading} items={searches} />}
      {tab === "templates" && <TemplatesTable loading={loading} items={templates} />}
      {tab === "inbox" && <InboxList loading={loading} items={inbox} />}

      <NewSearchModal open={newSearchOpen} onClose={() => setNewSearchOpen(false)} onSaved={() => { setNewSearchOpen(false); load(); }} />
      <NewTemplateModal open={newTemplateOpen} onClose={() => setNewTemplateOpen(false)} onSaved={() => { setNewTemplateOpen(false); load(); }} />
    </div>
  );
}

function TabBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition " +
        (active ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function DataTable({
  loading,
  items,
  statuses
}: {
  loading: boolean;
  items: Lead[];
  statuses: { value: string; label: string; color: string }[];
}) {
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="No hay leads aún. Procesa los datos aparcados desde /admin/editorial → Procesar aparcados, o lanza una búsqueda nueva." />;
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-5 py-3">Negocio</th>
            <th className="text-left px-3 py-3">Teléfono</th>
            <th className="text-left px-3 py-3">Score</th>
            <th className="text-left px-3 py-3">Rating</th>
            <th className="text-left px-3 py-3">WhatsApp</th>
            <th className="text-left px-3 py-3">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((l) => {
            const s = statuses.find((x) => x.value === l.contactStatus) ?? statuses[0];
            return (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="font-medium truncate">{l.name}</div>
                  {l.website && (
                    <a
                      href={l.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-slate-500 hover:text-brand-600 truncate block"
                    >
                      {l.website}
                    </a>
                  )}
                </td>
                <td className="px-3 py-3 text-xs">{l.phone ?? "—"}</td>
                <td className="px-3 py-3 text-xs tabular-nums">{l.score !== null ? l.score.toFixed(1) : "—"}</td>
                <td className="px-3 py-3 text-xs">
                  {l.rating !== null ? `${l.rating.toFixed(1)} ⭐ (${l.reviewsCount})` : "—"}
                </td>
                <td className="px-3 py-3 text-xs">
                  {l.hasWhatsapp ? <span className="text-emerald-600">✓</span> : "—"}
                </td>
                <td className="px-3 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-md border ${s.color}`}>{s.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SearchesTable({ loading, items }: { loading: boolean; items: SearchRow[] }) {
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="No hay búsquedas todavía." />;
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-5 py-3">Keyword</th>
            <th className="text-left px-3 py-3">Localidad</th>
            <th className="text-left px-3 py-3">Estado</th>
            <th className="text-left px-3 py-3">Resultados</th>
            <th className="text-left px-3 py-3">Creada</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50">
              <td className="px-5 py-3 font-medium">{s.keyword}</td>
              <td className="px-3 py-3 text-slate-600">{s.location}</td>
              <td className="px-3 py-3 text-xs">{s.status}</td>
              <td className="px-3 py-3 text-xs tabular-nums">{s._count.leads}</td>
              <td className="px-3 py-3 text-xs text-slate-500">
                {new Date(s.createdAt).toLocaleDateString("es-ES")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplatesTable({ loading, items }: { loading: boolean; items: Template[] }) {
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty msg="No hay plantillas." />;
  return (
    <div className="space-y-2">
      {items.map((t) => (
        <div key={t.id} className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <div className="font-medium">{t.name}</div>
            <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-md bg-slate-100">{t.channel}</span>
          </div>
          <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{t.body}</p>
        </div>
      ))}
    </div>
  );
}

function InboxList({ loading, items }: { loading: boolean; items: InboxRow[] }) {
  if (loading) return <Loading />;
  if (items.length === 0) {
    return <Empty msg="Inbox vacío. Los mensajes que reciba la Evolution API aparecerán aquí." />;
  }
  return (
    <div className="space-y-2">
      {items.map((m) => (
        <div key={m.id} className={"bg-white rounded-xl border p-4 " + (m.read ? "" : "border-brand-200 bg-brand-50/30")}>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-brand-600" />
              {m.lead?.name ?? m.fromPhone}
            </div>
            <div className="text-xs text-slate-500">
              {new Date(m.receivedAt).toLocaleString("es-ES")}
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{m.body}</p>
          {!m.lead && (
            <p className="mt-1 text-[11px] text-amber-700">
              Remitente {m.fromPhone} no asociado a ningún lead conocido.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Loading() {
  return (
    <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
    </div>
  );
}
function Empty({ msg }: { msg: string }) {
  return <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">{msg}</div>;
}

function NewSearchModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setKeyword("");
      setLocation("");
    }
  }, [open]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await fetch("/api/v1/leads/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, location })
    });
    setSaving(false);
    if (r.ok) onSaved();
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva búsqueda"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
          <button
            onClick={save as any}
            disabled={saving || !keyword || !location}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear (queda PENDING)
          </button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Keyword</label>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="ej. cafeterías especialidad"
            autoFocus
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Localidad</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="ej. Madrid, Pontevedra…"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <p className="text-[11px] text-slate-500">
          La búsqueda se crea en estado PENDING. El procesamiento real (Google Places + scoring) se conecta a la API de Google cuando configures la key y un cron disparador. Por ahora sirve para tener el registro y subir leads manualmente / vía importación.
        </p>
      </form>
    </Modal>
  );
}

function NewTemplateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setBody("");
      setChannel("whatsapp");
    }
  }, [open]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await fetch("/api/v1/leads/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, body, channel })
    });
    setSaving(false);
    if (r.ok) onSaved();
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva plantilla"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
          <button
            onClick={save as any}
            disabled={saving || !name || !body}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear
          </button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Canal</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Mensaje</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Hola {{nombre}}, vi tu negocio…"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Soporta variables tipo <code>{`{{nombre}}`}</code>, <code>{`{{ciudad}}`}</code> que se sustituyen en envío.
          </p>
        </div>
      </form>
    </Modal>
  );
}
