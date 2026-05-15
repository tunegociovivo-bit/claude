"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { Plus, Loader2, Trash2, Calendar, Filter, Loader, RefreshCw } from "lucide-react";
import type { UiClient } from "@/lib/db/queries";

type EditorialPost = {
  id: string;
  title: string;
  content: string | null;
  excerpt: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  status: string;
  format: string | null;
  networks: string;
  thumbnail: string | null;
  mediaUrls: string;
  client?: { id: string; name: string } | null;
  _count: { revisions: number };
};

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Borrador", color: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "REVIEW", label: "Revisión", color: "bg-amber-100 text-amber-800 border-amber-200" },
  { value: "APPROVED", label: "Aprobada", color: "bg-sky-100 text-sky-800 border-sky-200" },
  { value: "SCHEDULED", label: "Programada", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  { value: "PUBLISHED", label: "Publicada", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { value: "ARCHIVED", label: "Archivada", color: "bg-rose-50 text-rose-700 border-rose-200" }
];

const NETWORK_OPTIONS = ["instagram", "facebook", "linkedin", "tiktok", "x", "youtube", "blog", "email"];

export default function EditorialClient() {
  const [posts, setPosts] = useState<EditorialPost[]>([]);
  const [clients, setClients] = useState<UiClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterClient, setFilterClient] = useState("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditorialPost | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processReport, setProcessReport] = useState<any>(null);

  async function load() {
    setLoading(true);
    const [pr, cr] = await Promise.all([
      fetch("/api/v1/editorial/posts"),
      fetch("/api/v1/clients")
    ]);
    if (pr.ok) setPosts((await pr.json()).items ?? []);
    if (cr.ok) setClients((await cr.json()).items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function processPending() {
    if (!confirm("Procesar los datos aparcados desde la migración WP (publicaciones NV Dashboard + leads NV Leads). ¿Continuar?")) return;
    setProcessing(true);
    const r = await fetch("/api/v1/admin/process-pending-import", { method: "POST" });
    setProcessing(false);
    if (r.ok) {
      const d = await r.json();
      setProcessReport(d.report);
      load();
    } else {
      alert("Error procesando datos aparcados");
    }
  }

  async function deletePost(id: string, title: string) {
    if (!confirm(`¿Eliminar "${title}"?`)) return;
    const r = await fetch(`/api/v1/editorial/posts/${id}`, { method: "DELETE" });
    if (r.ok) load();
  }

  const filtered = posts.filter((p) => {
    if (filterStatus !== "ALL" && p.status !== filterStatus) return false;
    if (filterClient !== "ALL" && p.client?.id !== filterClient) return false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Calendario editorial"
        description="Publicaciones multi-cliente migradas de NV Dashboard. Estado de cada pieza, programación y aprobación."
        actions={
          <>
            <button
              onClick={processPending}
              disabled={processing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border text-sm hover:bg-slate-50 disabled:opacity-50"
              title="Procesa los datos aparcados desde la migración WP"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Procesar aparcados
            </button>
            <button
              onClick={() => { setEditing(null); setFormOpen(true); }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Nueva publicación
            </button>
          </>
        }
      />

      {processReport && (
        <div className="mb-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
          <strong>Procesado:</strong> {processReport.editorialPostsCreated} publicaciones,
          {" "}{processReport.leadsProcessed} leads, {processReport.leadSearchesProcessed} búsquedas,
          {" "}{processReport.templatesProcessed} plantillas, {processReport.inboxProcessed} mensajes inbox.
          {processReport.errors?.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-rose-700 text-xs">
                {processReport.errors.length} errores
              </summary>
              <ul className="mt-1 text-xs space-y-0.5 max-h-40 overflow-y-auto">
                {processReport.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-500">Estado:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-transparent font-medium focus:outline-none"
          >
            <option value="ALL">Todos</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs">
          <span className="text-slate-500">Cliente:</span>
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="bg-transparent font-medium focus:outline-none"
          >
            <option value="ALL">Todos</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">
          {posts.length === 0
            ? "Aún no hay publicaciones. Pulsa Procesar aparcados si migraste desde WP o Nueva publicación."
            : "No hay publicaciones que coincidan con el filtro."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3">Título</th>
                <th className="text-left px-3 py-3">Cliente</th>
                <th className="text-left px-3 py-3">Fecha</th>
                <th className="text-left px-3 py-3">Estado</th>
                <th className="text-left px-3 py-3">Formato</th>
                <th className="text-right px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((p) => {
                const st = STATUS_OPTIONS.find((s) => s.value === p.status) ?? STATUS_OPTIONS[0];
                return (
                  <tr key={p.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => { setEditing(p); setFormOpen(true); }}>
                    <td className="px-5 py-3 font-medium truncate max-w-xs">{p.title}</td>
                    <td className="px-3 py-3 text-slate-600">{p.client?.name ?? "—"}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {p.scheduledFor ? new Date(p.scheduledFor).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-md border ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 capitalize">{p.format ?? "—"}</td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => deletePost(p.id, p.title)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PostFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        post={editing}
        clients={clients}
        onSaved={() => { setFormOpen(false); load(); }}
      />
    </div>
  );
}

function PostFormModal({
  open,
  onClose,
  post,
  clients,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  post: EditorialPost | null;
  clients: UiClient[];
  onSaved: () => void;
}) {
  const isEdit = !!post;
  const [form, setForm] = useState({
    title: "",
    content: "",
    excerpt: "",
    scheduledFor: "",
    status: "DRAFT",
    format: "post",
    clientId: "",
    networks: [] as string[]
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (post) {
      const nets = (() => {
        try { return JSON.parse(post.networks); } catch { return []; }
      })();
      setForm({
        title: post.title,
        content: post.content ?? "",
        excerpt: post.excerpt ?? "",
        scheduledFor: post.scheduledFor ? new Date(post.scheduledFor).toISOString().slice(0, 16) : "",
        status: post.status,
        format: post.format ?? "post",
        clientId: post.client?.id ?? "",
        networks: nets
      });
    } else {
      setForm({
        title: "",
        content: "",
        excerpt: "",
        scheduledFor: "",
        status: "DRAFT",
        format: "post",
        clientId: clients[0]?.id ?? "",
        networks: []
      });
    }
  }, [open, post, clients]);

  function toggleNetwork(n: string) {
    setForm((f) => ({
      ...f,
      networks: f.networks.includes(n) ? f.networks.filter((x) => x !== n) : [...f.networks, n]
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: any = {
      title: form.title,
      content: form.content || undefined,
      excerpt: form.excerpt || undefined,
      status: form.status,
      format: form.format || undefined,
      clientId: form.clientId || undefined,
      networks: form.networks
    };
    if (form.scheduledFor) payload.scheduledFor = new Date(form.scheduledFor).toISOString();

    const url = isEdit ? `/api/v1/editorial/posts/${post!.id}` : "/api/v1/editorial/posts";
    const method = isEdit ? "PATCH" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar publicación" : "Nueva publicación"}
      size="xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="editorial-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <form id="editorial-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Título</label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Cliente</label>
            <select
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— Sin cliente —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Estado</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Formato</label>
            <select
              value={form.format}
              onChange={(e) => setForm({ ...form, format: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {["post", "reel", "story", "video", "blog", "email", "carousel"].map((x) =>
                <option key={x} value={x}>{x}</option>
              )}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Fecha programada</label>
          <input
            type="datetime-local"
            value={form.scheduledFor}
            onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Redes destino</label>
          <div className="flex flex-wrap gap-1.5">
            {NETWORK_OPTIONS.map((n) => {
              const sel = form.networks.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleNetwork(n)}
                  className={
                    "px-2.5 py-1 rounded-md text-xs capitalize transition border " +
                    (sel
                      ? "bg-brand-50 border-brand-300 text-brand-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Excerpt</label>
          <textarea
            value={form.excerpt}
            onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Contenido</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={8}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
