"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import {
  Plus,
  Loader2,
  Trash2,
  Filter,
  RefreshCw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Send,
  Copy,
  Calendar as CalendarIcon,
  List as ListIcon,
  BarChart3,
  FileDown,
  Mail,
  Image as ImageIcon,
  Video,
  Film,
  FileText as FileTextIcon,
  Pencil,
  Eye,
  Hourglass,
  CheckCheck
} from "lucide-react";
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
  metaJson?: any; // metadatos originales del plugin WP (ACF fields)
  client?: { id: string; name: string } | null;
  _count?: { revisions: number };
};

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Borrador", color: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
  { value: "REVIEW", label: "Revisión", color: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  { value: "APPROVED", label: "Aprobada", color: "bg-sky-100 text-sky-800 border-sky-200", dot: "bg-sky-500" },
  { value: "SCHEDULED", label: "Programada", color: "bg-indigo-100 text-indigo-800 border-indigo-200", dot: "bg-indigo-500" },
  { value: "PUBLISHED", label: "Publicada", color: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  { value: "ARCHIVED", label: "Archivada", color: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-400" }
];

const NETWORK_OPTIONS = ["instagram", "facebook", "linkedin", "tiktok", "x", "youtube", "blog", "email"];

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarCells(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = (first.getUTCDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: ({ date: Date } | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(Date.UTC(year, month - 1, d)) });
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// Extrae hashtags de un post: primero busca claves típicas en metaJson,
// si no las encuentra cae a regex sobre content/excerpt.
function extractHashtags(post: EditorialPost): string[] {
  const meta: any = post.metaJson ?? {};
  const candidates = [
    meta.hashtags,
    meta.hashtag,
    meta.etiquetas,
    meta.tags,
    meta.tags_redes,
    meta.ig_hashtags,
    meta.instagram_hashtags,
    meta.hashtags_post,
    meta.hashtags_publicacion
  ];
  // Si alguno es array → tomarlo
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c
        .map((x) => String(x).trim())
        .filter(Boolean)
        .map((x) => (x.startsWith("#") ? x : `#${x}`));
    }
  }
  // Si alguno es string → parsear (split por espacio/coma/salto)
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      const tokens = c
        .split(/[\s,;\n]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`));
      if (tokens.length > 0) return tokens;
    }
  }
  // Fallback: regex sobre content
  const text = `${post.content ?? ""}\n${post.excerpt ?? ""}`;
  const matches = text.match(/#[\p{L}0-9_]+/gu);
  return matches ? Array.from(new Set(matches)) : [];
}

// Quita los hashtags del final del copy (no se ven duplicados en preview)
function stripTrailingHashtags(text: string): string {
  if (!text) return "";
  // Elimina líneas finales que solo contengan hashtags
  return text.replace(/(?:\s*#[\p{L}0-9_]+)+\s*$/gu, "").trim();
}

function formatIcon(format: string | null) {
  const f = (format ?? "").toLowerCase();
  if (f.includes("reel") || f.includes("video")) return Film;
  if (f.includes("story") || f.includes("historia")) return Video;
  if (f.includes("blog") || f.includes("articulo")) return FileTextIcon;
  return ImageIcon;
}

function formatNetworkColor(n: string): string {
  const k = n.toLowerCase();
  if (k.includes("instagram")) return "bg-pink-50 text-pink-700 border-pink-200";
  if (k.includes("facebook")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (k.includes("linkedin")) return "bg-sky-50 text-sky-700 border-sky-200";
  if (k.includes("tiktok")) return "bg-slate-900/5 text-slate-800 border-slate-300";
  if (k.includes("x") || k.includes("twitter")) return "bg-slate-100 text-slate-800 border-slate-300";
  if (k.includes("youtube")) return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export default function EditorialClient() {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const [view, setView] = useState<"calendar" | "list">("calendar");

  const [posts, setPosts] = useState<EditorialPost[]>([]);
  const [clients, setClients] = useState<UiClient[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterClient, setFilterClient] = useState("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditorialPost | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [metricoolOpen, setMetricoolOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagData, setDiagData] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [processReport, setProcessReport] = useState<any>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const month = monthKey(cursor);
  const year = cursor.getUTCFullYear();
  const monthNum = cursor.getUTCMonth() + 1;
  const cells = useMemo(() => buildCalendarCells(year, monthNum), [year, monthNum]);

  async function load() {
    setLoading(true);
    const qs = `?month=${month}${filterClient !== "ALL" ? `&clientId=${filterClient}` : ""}`;
    const [pr, cr, sr] = await Promise.all([
      fetch(`/api/v1/editorial/posts${qs}`),
      fetch("/api/v1/clients"),
      fetch(`/api/v1/editorial/stats${qs}`)
    ]);
    if (pr.ok) setPosts((await pr.json()).items ?? []);
    if (cr.ok) setClients((await cr.json()).items ?? []);
    if (sr.ok) setStats(await sr.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [month, filterClient]);

  async function openDiagnostic() {
    setDiagOpen(true);
    setDiagLoading(true);
    setDiagData(null);
    const r = await fetch("/api/v1/admin/pending-import-status");
    if (r.ok) setDiagData(await r.json());
    setDiagLoading(false);
  }

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

  async function doMonthAction(action: "approve" | "schedule" | "publish" | "archive" | "duplicate") {
    const labels: Record<string, string> = {
      approve: "aprobar TODAS las publicaciones del mes",
      schedule: "marcar como programadas todas las aprobadas",
      publish: "marcar como publicadas todas las programadas",
      archive: "archivar TODAS las publicaciones del mes",
      duplicate: "duplicar todas las publicaciones a otro mes"
    };
    if (!confirm(`¿Confirmas ${labels[action]} (${filterClient !== "ALL" ? "del cliente seleccionado" : "de todos los clientes"})?`)) return;

    let targetMonth: string | undefined;
    if (action === "duplicate") {
      const next = new Date(Date.UTC(year, monthNum, 1));
      const def = monthKey(next);
      const input = prompt(`Mes destino (YYYY-MM), por defecto ${def}:`, def);
      if (!input) return;
      targetMonth = input;
    }

    const r = await fetch("/api/v1/editorial/month-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        month,
        clientId: filterClient !== "ALL" ? filterClient : undefined,
        targetMonth
      })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setActionMsg(`✓ ${labels[action]}: ${j.affected ?? j.created ?? 0} publicaciones afectadas`);
      setTimeout(() => setActionMsg(null), 4000);
      load();
    } else {
      alert(j?.error?.message ?? "Error");
    }
  }

  const filtered = posts.filter((p) => filterStatus === "ALL" || p.status === filterStatus);

  const postsByDay = useMemo(() => {
    const m = new Map<string, EditorialPost[]>();
    for (const p of filtered) {
      if (!p.scheduledFor) continue;
      const key = p.scheduledFor.slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    return m;
  }, [filtered]);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Calendario editorial"
        description="Migrado de NV Dashboard. Genera meses completos con IA, aprueba en lote, exporta a Metricool."
        actions={
          <>
            <button
              onClick={openDiagnostic}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border text-sm hover:bg-slate-50"
              title="Ver qué datos hay aparcados desde WP"
            >
              <BarChart3 className="h-4 w-4" />
              Ver pendiente
            </button>
            <button
              onClick={processPending}
              disabled={processing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Procesar aparcados
            </button>
            <button
              onClick={() => setGenerateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
            >
              <Sparkles className="h-4 w-4" />
              Generar mes con IA
            </button>
            <button
              onClick={() => setMetricoolOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
              title="Exporta las publicaciones aprobadas en CSV para subir a Metricool"
            >
              <FileDown className="h-4 w-4" />
              Exportar a Metricool
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
          {" "}{processReport.editorialClientsCreated ?? 0} clientes nuevos
          {(processReport.editorialClientsUpdated ?? 0) > 0 && (
            <> ({processReport.editorialClientsUpdated} actualizados con notas)</>
          )},
          {" "}{processReport.leadsProcessed} leads, {processReport.leadSearchesProcessed} búsquedas,
          {" "}{processReport.templatesProcessed} plantillas, {processReport.inboxProcessed} mensajes inbox.
        </div>
      )}
      {actionMsg && (
        <div className="mb-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
          {actionMsg}
        </div>
      )}

      {/* Estadísticas del mes */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 mb-4">
          <StatCard label="Total mes" value={stats.total} accent="bg-brand-50 text-brand-700" />
          {STATUS_OPTIONS.map((s) => (
            <StatCard key={s.value} label={s.label} value={stats.byStatus[s.value] ?? 0} accent={s.color} />
          ))}
        </div>
      )}

      {/* Navegación de mes + filtros + acciones */}
      <div className="flex items-center flex-wrap gap-2 mb-4">
        <div className="inline-flex items-center bg-white border rounded-lg p-0.5">
          <button
            onClick={() => setCursor(new Date(Date.UTC(year, monthNum - 2, 1)))}
            className="h-7 w-7 grid place-items-center rounded hover:bg-slate-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold px-3 capitalize">
            {cursor.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })}
          </span>
          <button
            onClick={() => setCursor(new Date(Date.UTC(year, monthNum, 1)))}
            className="h-7 w-7 grid place-items-center rounded hover:bg-slate-100"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center bg-white border rounded-lg p-0.5">
          <button
            onClick={() => setView("calendar")}
            className={
              "px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 " +
              (view === "calendar" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900")
            }
          >
            <CalendarIcon className="h-3 w-3" />
            Calendario
          </button>
          <button
            onClick={() => setView("list")}
            className={
              "px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 " +
              (view === "list" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900")
            }
          >
            <ListIcon className="h-3 w-3" />
            Lista
          </button>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
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
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs">
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

        <div className="ml-auto flex items-center gap-1">
          <ActionButton onClick={() => doMonthAction("approve")} icon={<CheckCircle2 className="h-3 w-3" />}>Aprobar mes</ActionButton>
          <ActionButton onClick={() => doMonthAction("schedule")} icon={<CalendarIcon className="h-3 w-3" />}>Programar</ActionButton>
          <ActionButton onClick={() => doMonthAction("publish")} icon={<Send className="h-3 w-3" />}>Publicar</ActionButton>
          <ActionButton onClick={() => doMonthAction("duplicate")} icon={<Copy className="h-3 w-3" />}>Duplicar</ActionButton>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : view === "calendar" ? (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <div className="grid grid-cols-7 text-xs uppercase tracking-wide text-slate-500 border-b bg-slate-50">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
              <div key={d} className="px-3 py-2 border-r last:border-r-0">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 auto-rows-[130px]">
            {cells.map((cell, idx) => {
              if (!cell) return <div key={idx} className="border-r border-b last:border-r-0 bg-slate-50/30" />;
              const iso = cell.date.toISOString().slice(0, 10);
              const dayPosts = postsByDay.get(iso) ?? [];
              const isToday = iso === today.toISOString().slice(0, 10);
              return (
                <div
                  key={idx}
                  className="border-r border-b last:border-r-0 p-1.5 overflow-hidden hover:bg-brand-50/20 transition cursor-pointer"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                    // pre-set fecha al crear desde día concreto: lo manejaremos al abrir el modal
                  }}
                >
                  <div className={"text-xs font-medium mb-1 " + (isToday ? "text-brand-600" : "text-slate-700")}>
                    <span
                      className={
                        isToday
                          ? "inline-block h-5 w-5 rounded-full bg-brand-600 text-white grid place-items-center leading-5 text-center"
                          : ""
                      }
                    >
                      {cell.date.getUTCDate()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {dayPosts.slice(0, 3).map((p) => {
                      const st = STATUS_OPTIONS.find((s) => s.value === p.status) ?? STATUS_OPTIONS[0];
                      return (
                        <button
                          key={p.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(p);
                            setFormOpen(true);
                          }}
                          className={`block w-full text-left text-[11px] px-1.5 py-0.5 rounded border truncate ${st.color} hover:opacity-80`}
                          title={p.title}
                        >
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${st.dot} mr-1`} />
                          {p.title}
                        </button>
                      );
                    })}
                    {dayPosts.length > 3 && (
                      <div className="text-[10px] text-slate-500 pl-1">+{dayPosts.length - 3} más</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">
          {posts.length === 0
            ? "Sin publicaciones este mes. Genera un mes con IA o crea una manualmente."
            : "Ninguna publicación coincide con el filtro de estado."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
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
                      <span className={`text-xs px-2 py-0.5 rounded-md border ${st.color}`}>{st.label}</span>
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
        defaultMonth={month}
        onSaved={() => { setFormOpen(false); load(); }}
      />

      <GenerateMonthModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        clients={clients}
        month={month}
        onDone={() => { setGenerateOpen(false); load(); }}
      />

      <MetricoolExportModal
        open={metricoolOpen}
        onClose={() => setMetricoolOpen(false)}
        month={month}
        clients={clients}
        defaultClientId={filterClient !== "ALL" ? filterClient : undefined}
        onDone={() => { setMetricoolOpen(false); load(); }}
      />

      <Modal
        open={diagOpen}
        onClose={() => setDiagOpen(false)}
        title="Datos aparcados desde WP"
        size="lg"
      >
        {diagLoading ? (
          <div className="text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando…
          </div>
        ) : !diagData ? (
          <p className="text-sm text-slate-500">Sin datos.</p>
        ) : (
          <div className="space-y-4 text-sm">
            {diagData.nvDashboard ? (
              <div>
                <h3 className="font-semibold mb-2">NV Dashboard</h3>
                <ul className="space-y-1 text-slate-700">
                  <li>Publicaciones aparcadas: <strong>{diagData.nvDashboard.publicationsCount}</strong></li>
                  <li>Clientes en taxonomía nv_cliente: <strong>{diagData.nvDashboard.clientesTaxonomyCount}</strong></li>
                  <li>Configuraciones por cliente: <strong>{diagData.nvDashboard.clienteConfigsKeys.length}</strong></li>
                  <li>Importado: {diagData.nvDashboard.importedAt ? new Date(diagData.nvDashboard.importedAt).toLocaleString("es-ES") : "—"}</li>
                  {diagData.nvDashboard.truncated && (
                    <li className="text-amber-700">⚠️ Truncado durante import (datos parciales)</li>
                  )}
                </ul>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-xs uppercase text-slate-500 mb-1">Desde taxonomía</div>
                    <div className="text-xs space-y-0.5">
                      {diagData.nvDashboard.clientesTaxonomyNames.length === 0 ? (
                        <p className="italic text-slate-500">—</p>
                      ) : (
                        diagData.nvDashboard.clientesTaxonomyNames.slice(0, 20).map((n: string) => (
                          <div key={n}>· {n}</div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-xs uppercase text-slate-500 mb-1">Desde publicaciones</div>
                    <div className="text-xs space-y-0.5">
                      {diagData.nvDashboard.clientNamesFoundInPublications.length === 0 ? (
                        <p className="italic text-slate-500">—</p>
                      ) : (
                        diagData.nvDashboard.clientNamesFoundInPublications.slice(0, 20).map((n: string) => (
                          <div key={n}>· {n}</div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 px-3 py-2 rounded-lg bg-brand-50 border border-brand-200 text-xs">
                  <strong>Resumen:</strong> {diagData.clientsFoundInPending.total} nombres distintos encontrados.{" "}
                  {diagData.clientsFoundInPending.alreadyInDb} ya existen en tu BD ·{" "}
                  {diagData.clientsFoundInPending.willBeCreated} se crearán al pulsar "Procesar aparcados".
                </div>
                {diagData.clientsFoundInPending.willBeCreatedNames.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-slate-600">Ver nombres que se crearán</summary>
                    <div className="mt-1 pl-4 text-slate-600">
                      {diagData.clientsFoundInPending.willBeCreatedNames.join(", ")}
                    </div>
                  </details>
                )}

                {/* Sample de publicaciones — claves meta reales del plugin */}
                {Array.isArray(diagData.nvDashboard.samplePublications) && diagData.nvDashboard.samplePublications.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-medium text-slate-700">
                      🔍 Inspeccionar campos ACF reales (sample 3 publicaciones)
                    </summary>
                    <div className="mt-2 space-y-3">
                      {diagData.nvDashboard.samplePublications.map((s: any) => (
                        <div key={s.id} className="bg-slate-50 border rounded-lg p-2">
                          <div className="font-medium mb-1">{s.title}</div>
                          <div className="text-slate-500 text-[10px] mb-2">
                            ID {s.id} · {s.metaKeyCount} campos meta · {s.thumbnail ? "thumbnail ✓" : "sin thumbnail"}
                          </div>
                          <dl className="space-y-0.5">
                            {Object.entries(s.meta ?? {}).map(([k, v]) => (
                              <div key={k} className="grid grid-cols-[140px_1fr] gap-1.5">
                                <dt className="font-mono text-slate-500 truncate" title={k}>{k}</dt>
                                <dd className="text-slate-700 break-words">{String(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">
                      Estas son las claves <strong>reales</strong> que el plugin tenía guardadas. Si ves nombres como
                      "<code>contenido_facebook</code>" o "<code>imagen_destacada_personalizada</code>" que no estén siendo capturados,
                      dímelos y los añado al mapping.
                    </p>
                  </details>
                )}
              </div>
            ) : (
              <p className="text-slate-500 italic">No hay datos NV Dashboard aparcados.</p>
            )}

            {diagData.nvLeads ? (
              <div>
                <h3 className="font-semibold mb-2">NV Leads Pro</h3>
                <ul className="space-y-1 text-slate-700 text-xs">
                  {Object.entries(diagData.nvLeads.tableCounts).map(([k, v]) => (
                    <li key={k}>· {k}: <strong>{String(v)}</strong></li>
                  ))}
                </ul>
                {diagData.nvLeads.truncated && (
                  <p className="text-amber-700 text-xs mt-1">⚠️ Truncado durante import</p>
                )}
              </div>
            ) : null}

            <p className="text-xs text-slate-500">
              Procesado por última vez: {diagData.processedAt ? new Date(diagData.processedAt).toLocaleString("es-ES") : "nunca"}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MetricoolExportModal({
  open,
  onClose,
  month,
  clients,
  defaultClientId,
  onDone
}: {
  open: boolean;
  onClose: () => void;
  month: string;
  clients: UiClient[];
  defaultClientId?: string;
  onDone: () => void;
}) {
  const [targetMonth, setTargetMonth] = useState(month);
  const [clientId, setClientId] = useState(defaultClientId ?? "ALL");
  const [statuses, setStatuses] = useState<string[]>(["APPROVED", "SCHEDULED"]);
  const [onlyNotExported, setOnlyNotExported] = useState(false);
  const [markScheduled, setMarkScheduled] = useState(true);
  const [email, setEmail] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTargetMonth(month);
    setClientId(defaultClientId ?? "ALL");
    setStatuses(["APPROVED", "SCHEDULED"]);
    setOnlyNotExported(false);
    setMarkScheduled(true);
    setResult(null);
    setError(null);
    // Prefill email con el del current user
    fetch("/api/v1/me").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.user?.email) setEmail(d.user.email);
    });
  }, [open, month, defaultClientId]);

  function toggleStatus(s: string) {
    setStatuses((arr) => (arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s]));
  }

  async function run(sendEmail: boolean) {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/v1/editorial/export-metricool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: targetMonth,
          clientId: clientId !== "ALL" ? clientId : undefined,
          statuses,
          onlyNotExported,
          markAsScheduled: markScheduled,
          email: sendEmail ? email : undefined,
          sendEmail
        })
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setError(data?.error?.message ?? `Error ${r.status}`);
        setRunning(false);
        return;
      }
      setResult(data);
      // Si NO se mandó por email, descargamos directamente
      if (!sendEmail) {
        const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Exportar a Metricool"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cerrar
          </button>
          <button
            onClick={() => run(false)}
            disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Descargar CSV
          </button>
          <button
            onClick={() => run(true)}
            disabled={running || !email}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Enviar por email
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Genera un CSV con las publicaciones del calendario en el formato que el importador de Metricool acepta. Una fila por (publicación × red social). Puedes <strong>descargarlo y subirlo manualmente</strong>, o <strong>mandártelo por email</strong> si Resend está configurado.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Mes</label>
            <input
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Cliente</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">Todos</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Estados a incluir</label>
          <div className="flex flex-wrap gap-1.5">
            {["DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED"].map((s) => {
              const sel = statuses.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={
                    "px-2.5 py-1 rounded-md text-xs transition border " +
                    (sel
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={onlyNotExported}
            onChange={(e) => setOnlyNotExported(e.target.checked)}
            className="rounded"
          />
          Solo publicaciones no exportadas antes (incremental)
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={markScheduled}
            onChange={(e) => setMarkScheduled(e.target.checked)}
            className="rounded"
          />
          Marcar como "Programadas" tras exportar
        </label>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Email destino <span className="text-slate-400 font-normal">(para "Enviar por email")</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Si no tienes Resend configurado, el botón de email no funcionará. Mientras tanto usa "Descargar CSV" y mándalo tú mismo.
          </p>
        </div>

        {result && (
          <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            ✓ {result.rowCount} filas generadas ({result.postCount} publicaciones).
            {result.emailSent ? " Email enviado correctamente." : " CSV descargado."}
          </div>
        )}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${accent}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ActionButton({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs bg-white border hover:bg-slate-50"
    >
      {icon}
      {children}
    </button>
  );
}

function GenerateMonthModal({
  open,
  onClose,
  clients,
  month,
  onDone
}: {
  open: boolean;
  onClose: () => void;
  clients: UiClient[];
  month: string;
  onDone: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [count, setCount] = useState(8);
  const [networks, setNetworks] = useState<string[]>(["instagram"]);
  const [brief, setBrief] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!open) return;
    setClientId(clients[0]?.id ?? "");
    setCount(8);
    setNetworks(["instagram"]);
    setBrief("");
    setError(null);
    setResult(null);
  }, [open, clients]);

  function toggle(n: string) {
    setNetworks((arr) => (arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n]));
  }

  async function run() {
    if (!clientId) {
      setError("Selecciona un cliente");
      return;
    }
    setRunning(true);
    setError(null);
    const r = await fetch("/api/v1/editorial/generate-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, month, count, networks, brief: brief || undefined })
    });
    setRunning(false);
    const data = await r.json();
    if (!r.ok) {
      setError(data?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setResult(data);
    setTimeout(() => onDone(), 1500);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Generar mes con IA — ${month}`}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
          <button
            onClick={run}
            disabled={running || !clientId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Claude generará {count} publicaciones para el cliente seleccionado en {month}. Cada una queda en estado <strong>Borrador</strong> para que las revises antes de publicar.
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Cliente *</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="" disabled>Selecciona…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Número de publicaciones</label>
          <input
            type="number"
            min={1}
            max={31}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Redes destino</label>
          <div className="flex flex-wrap gap-1.5">
            {NETWORK_OPTIONS.map((n) => {
              const sel = networks.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggle(n)}
                  className={
                    "px-2.5 py-1 rounded-md text-xs capitalize transition border " +
                    (sel
                      ? "bg-violet-50 border-violet-300 text-violet-700"
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
          <label className="block text-xs font-medium text-slate-700 mb-1">Brief (opcional)</label>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder="Ej. enfoca el mes en sostenibilidad y nuevos productos otoño"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {result && (
          <p className="text-xs text-emerald-700">✓ {result.created} publicaciones creadas. Cerrando…</p>
        )}
      </div>
    </Modal>
  );
}

function PostFormModal({
  open,
  onClose,
  post,
  clients,
  defaultMonth,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  post: EditorialPost | null;
  clients: UiClient[];
  defaultMonth: string;
  onSaved: () => void;
}) {
  const isEdit = !!post;
  // Detalle recargado del servidor al abrir el modal, para asegurar que
  // tenemos metaJson y los campos más recientes aunque el listado tuviera
  // datos desactualizados.
  const [fullPost, setFullPost] = useState<EditorialPost | null>(null);
  // Modo del modal: en edición se abre primero la vista preview (como el plugin)
  // y desde ahí se puede pasar a editar; al crear nuevo va directo a edit.
  const [mode, setMode] = useState<"preview" | "edit">("preview");
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

  // Cuando abrimos el modal para editar, refrescamos detalle desde el servidor
  useEffect(() => {
    if (!open || !post) {
      setFullPost(null);
      return;
    }
    setFullPost(post); // pinta inmediato con lo del listado
    fetch(`/api/v1/editorial/posts/${post.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setFullPost(d as EditorialPost);
      })
      .catch(() => {});
  }, [open, post?.id]);

  // Reset del modo cuando se abre el modal: edit por defecto si es nuevo,
  // preview si estamos viendo uno existente.
  useEffect(() => {
    if (!open) return;
    setMode(post ? "preview" : "edit");
  }, [open, post?.id]);

  // Cuando fullPost se actualiza (con metaJson, etc.), si los campos del form
  // estaban vacíos, los rellenamos con la nueva info.
  useEffect(() => {
    if (!fullPost || !open) return;
    setForm((prev) => ({
      ...prev,
      content: prev.content || (fullPost.content ?? ""),
      excerpt: prev.excerpt || (fullPost.excerpt ?? ""),
      networks: prev.networks.length > 0 ? prev.networks : (() => {
        try { return JSON.parse(fullPost.networks); } catch { return []; }
      })()
    }));
  }, [fullPost, open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (post) {
      const nets = (() => { try { return JSON.parse(post.networks); } catch { return []; } })();
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
      const [y, m] = defaultMonth.split("-").map(Number);
      setForm({
        title: "",
        content: "",
        excerpt: "",
        scheduledFor: `${defaultMonth}-15T10:00`,
        status: "DRAFT",
        format: "post",
        clientId: clients[0]?.id ?? "",
        networks: ["instagram"]
      });
    }
  }, [open, post, clients, defaultMonth]);

  function toggleNetwork(n: string) {
    setForm((f) => ({ ...f, networks: f.networks.includes(n) ? f.networks.filter((x) => x !== n) : [...f.networks, n] }));
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
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    onSaved();
  }

  // Vista previa estilo plugin: imagen grande + copy + hashtags
  if (isEdit && mode === "preview" && fullPost) {
    const networks: string[] = (() => {
      try { return JSON.parse(fullPost.networks); } catch { return []; }
    })();
    let images: string[] = [];
    try {
      const parsed = JSON.parse(fullPost.mediaUrls);
      if (Array.isArray(parsed)) images = parsed.filter((u) => typeof u === "string");
    } catch {}
    if (fullPost.thumbnail && !images.includes(fullPost.thumbnail)) {
      images.unshift(fullPost.thumbnail);
    }
    const hashtags = extractHashtags(fullPost);
    const copyRaw = fullPost.content ?? fullPost.excerpt ?? "";
    const copyClean = hashtags.length > 0 ? stripTrailingHashtags(copyRaw) : copyRaw;
    const Icon = formatIcon(fullPost.format);
    const formatLabel = (fullPost.format ?? "").toUpperCase() || "POST";
    const statusOpt = STATUS_OPTIONS.find((s) => s.value === fullPost.status);
    const isApproved = ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(fullPost.status);
    const scheduledLabel = fullPost.scheduledFor
      ? new Date(fullPost.scheduledFor).toLocaleString("es-ES", {
          day: "numeric", month: "numeric", year: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit"
        })
      : null;

    return (
      <Modal
        open={open}
        onClose={onClose}
        title={fullPost.title}
        size="xl"
        footer={
          <>
            <div className="flex-1 flex items-center gap-3 text-xs text-slate-600">
              {statusOpt && (
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${statusOpt.dot}`} />
                  Estado: <span className="font-medium">{statusOpt.label.toLowerCase()}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                Aprobado:{" "}
                {isApproved ? <CheckCheck className="h-4 w-4 text-emerald-600" /> : <Hourglass className="h-4 w-4 text-amber-500" />}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Pencil className="h-4 w-4" />
              Editar publicación
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Icon className="h-4 w-4 text-slate-400" />
            <span className="font-medium tracking-wide">{formatLabel}</span>
            {scheduledLabel && <><span>·</span><span>{scheduledLabel}</span></>}
            {fullPost.client && <><span>·</span><span>{fullPost.client.name}</span></>}
          </div>

          <div className="grid md:grid-cols-[minmax(0,400px)_1fr] gap-5 items-start">
            <div>
              {images[0] ? (
                <a href={images[0]} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={images[0]}
                    alt={fullPost.title}
                    className="w-full aspect-square object-cover rounded-xl border bg-slate-50 hover:opacity-95 transition"
                  />
                </a>
              ) : (
                <div className="w-full aspect-square rounded-xl border bg-slate-50 flex items-center justify-center text-slate-400">
                  <ImageIcon className="h-10 w-10" />
                </div>
              )}
              {images.length > 1 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto">
                  {images.slice(1).map((u, i) => (
                    <a key={`${u}-${i}`} href={u} target="_blank" rel="noreferrer" className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`media-${i + 1}`} className="h-14 w-14 object-cover rounded-md border" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              {networks.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-1.5">Redes:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {networks.map((n) => (
                      <span key={n} className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${formatNetworkColor(n)}`}>
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-sm font-semibold text-slate-700 mb-1.5">Copy:</div>
                {copyClean ? (
                  <div className="rounded-lg border bg-slate-50/60 p-3 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {copyClean}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed bg-slate-50 p-3 text-xs text-slate-400">
                    Sin copy.
                  </div>
                )}
              </div>

              {hashtags.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-1.5">Hashtags:</div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-brand-600">
                    {hashtags.map((h, i) => (
                      <span key={`${h}-${i}`}>{h}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Inspector ACF (plegable) — útil para diagnosticar campos no mapeados */}
          {fullPost.metaJson && Object.keys(fullPost.metaJson as any).length > 0 && (
            <details className="rounded-lg border bg-slate-50">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
                📦 Datos originales del plugin WordPress ({Object.keys(fullPost.metaJson as any).length} campos)
              </summary>
              <div className="px-3 py-2 border-t bg-white">
                <p className="text-[11px] text-slate-500 mb-2">
                  Todos los campos ACF / metadatos que tenía esta publicación en el plugin original.
                </p>
                <dl className="text-xs space-y-1.5 max-h-80 overflow-y-auto">
                  {Object.entries(fullPost.metaJson as any).map(([k, v]) => {
                    if (v === null || v === undefined || v === "") return null;
                    const isUrl = typeof v === "string" && /^https?:\/\//.test(v);
                    const isImage = isUrl && /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(v);
                    const display = typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
                    return (
                      <div key={k} className="grid grid-cols-[140px_1fr] gap-2 items-start border-b border-slate-100 pb-1.5">
                        <dt className="font-mono text-[11px] text-slate-500 truncate" title={k}>{k}</dt>
                        <dd className="text-slate-700 break-words">
                          {isImage ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={v as string} alt={k} className="max-h-24 rounded border mb-1" />
                              <a href={v as string} target="_blank" rel="noreferrer" className="text-[10px] text-brand-600 underline break-all">
                                {v as string}
                              </a>
                            </>
                          ) : isUrl ? (
                            <a href={v as string} target="_blank" rel="noreferrer" className="text-brand-600 underline break-all">
                              {v as string}
                            </a>
                          ) : (
                            <pre className="whitespace-pre-wrap font-sans">{display.slice(0, 800)}{display.length > 800 ? "…" : ""}</pre>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            </details>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar publicación" : "Nueva publicación"}
      size="xl"
      footer={
        <>
          {isEdit && (
            <button
              type="button"
              onClick={() => setMode("preview")}
              className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              <Eye className="h-4 w-4" />
              Vista previa
            </button>
          )}
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
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
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
          placeholder="Título"
          className="w-full text-lg font-semibold px-0 py-1 bg-transparent border-0 border-b border-transparent focus:border-brand-500 focus:outline-none focus:ring-0"
        />
        <div className="grid grid-cols-3 gap-2">
          <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">— Sin cliente —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {["post", "reel", "story", "video", "blog", "email", "carousel"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <input
          type="datetime-local"
          value={form.scheduledFor}
          onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Redes destino</label>
          <div className="flex flex-wrap gap-1.5">
            {NETWORK_OPTIONS.map((n) => {
              const sel = form.networks.includes(n);
              return (
                <button key={n} type="button" onClick={() => toggleNetwork(n)}
                  className={"px-2.5 py-1 rounded-md text-xs capitalize transition border " + (sel ? "bg-brand-50 border-brand-300 text-brand-700" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")}>
                  {n}
                </button>
              );
            })}
          </div>
        </div>
        <textarea
          value={form.excerpt}
          onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
          rows={2}
          placeholder="Excerpt"
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          rows={10}
          placeholder="Contenido completo de la publicación"
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />

        {/* Preview de imágenes asociadas */}
        {fullPost && <MediaPreview post={fullPost} />}

        {/* Datos originales del plugin WP — todo lo que llegó en p.meta */}
        {fullPost && fullPost.metaJson && Object.keys(fullPost.metaJson as any).length > 0 && (
          <details className="rounded-lg border bg-slate-50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
              📦 Datos originales del plugin WordPress ({Object.keys(fullPost.metaJson as any).length} campos)
            </summary>
            <div className="px-3 py-2 border-t bg-white">
              <p className="text-[11px] text-slate-500 mb-2">
                Todos los campos ACF / metadatos que tenía esta publicación en el plugin original.
                Si alguno no se está mostrando bien arriba (copy, imagen, etc.), copia el valor desde aquí al campo correspondiente.
              </p>
              <dl className="text-xs space-y-1.5 max-h-80 overflow-y-auto">
                {Object.entries(fullPost.metaJson as any).map(([k, v]) => {
                  if (v === null || v === undefined || v === "") return null;
                  const isUrl = typeof v === "string" && /^https?:\/\//.test(v);
                  const isImage = isUrl && /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(v);
                  const display = typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
                  return (
                    <div key={k} className="grid grid-cols-[140px_1fr] gap-2 items-start border-b border-slate-100 pb-1.5">
                      <dt className="font-mono text-[11px] text-slate-500 truncate" title={k}>{k}</dt>
                      <dd className="text-slate-700 break-words">
                        {isImage ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={v as string} alt={k} className="max-h-24 rounded border mb-1" />
                            <a href={v as string} target="_blank" rel="noreferrer" className="text-[10px] text-brand-600 underline break-all">
                              {v as string}
                            </a>
                          </>
                        ) : isUrl ? (
                          <a href={v as string} target="_blank" rel="noreferrer" className="text-brand-600 underline break-all">
                            {v as string}
                          </a>
                        ) : (
                          <pre className="whitespace-pre-wrap font-sans">{display.slice(0, 800)}{display.length > 800 ? "…" : ""}</pre>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </details>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}

function MediaPreview({ post }: { post: EditorialPost }) {
  let urls: string[] = [];
  try {
    const parsed = JSON.parse(post.mediaUrls);
    if (Array.isArray(parsed)) urls = parsed.filter((u) => typeof u === "string");
  } catch {}
  if (post.thumbnail && !urls.includes(post.thumbnail)) urls.unshift(post.thumbnail);
  if (urls.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-medium text-slate-700 mb-1.5">Imágenes ({urls.length})</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {urls.map((u, i) => (
          <a
            key={`${u}-${i}`}
            href={u}
            target="_blank"
            rel="noreferrer"
            className="shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={u}
              alt={`media-${i}`}
              className="h-24 w-24 object-cover rounded-lg border hover:border-brand-300"
            />
          </a>
        ))}
      </div>
    </div>
  );
}
