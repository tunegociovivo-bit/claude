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
  hashtags?: string | null;
  firstComment?: string | null;
  copyByNetwork?: Record<string, string> | null;
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

// Extrae hashtags de un post: primero el campo dedicado, luego claves típicas
// en metaJson, luego regex sobre content/excerpt.
function extractHashtags(post: EditorialPost): string[] {
  // 0) Campo dedicado (nuevo schema)
  if (post.hashtags && post.hashtags.trim()) {
    const tokens = post.hashtags
      .split(/[\s,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));
    if (tokens.length > 0) return Array.from(new Set(tokens));
  }

  const meta: any = post.metaJson ?? {};

  // 1) Recorrer recursivamente metaJson buscando:
  //   a) claves cuyo nombre contenga hashtag/etiqueta/tag
  //   b) valores que contengan al menos 2 tokens "#palabra"
  const found: string[] = [];

  function pushTokens(raw: string) {
    const tokens = raw
      .split(/[\s,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));
    for (const t of tokens) if (/^#[\p{L}0-9_]+$/u.test(t)) found.push(t);
  }

  function walk(node: any, parentKey: string) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, parentKey);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith("_") || k.startsWith("field_")) continue;
        walk(v, k);
      }
      return;
    }
    if (typeof node !== "string") return;
    const looksLikeKey = /hashtag|etiqueta|^tags?$|_tags?$|tags_/i.test(parentKey);
    if (looksLikeKey) {
      pushTokens(node);
      return;
    }
    // Valor que ya viene con varios #algo → tomarlo
    const inline = node.match(/#[\p{L}0-9_]+/gu);
    if (inline && inline.length >= 2) {
      for (const m of inline) found.push(m);
    }
  }
  walk(meta, "");

  if (found.length > 0) {
    return Array.from(new Set(found));
  }

  // 2) Fallback: regex sobre content/excerpt completo
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
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [multiClientOpen, setMultiClientOpen] = useState(false);
  const [orphansOpen, setOrphansOpen] = useState(false);
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
    if (action === "duplicate") {
      // Abre modal dedicado en lugar de prompt
      setDuplicateOpen(true);
      return;
    }
    const labels: Record<string, string> = {
      approve: "aprobar TODAS las publicaciones del mes",
      schedule: "marcar como programadas todas las aprobadas",
      publish: "marcar como publicadas todas las programadas",
      archive: "archivar TODAS las publicaciones del mes"
    };
    if (!confirm(`¿Confirmas ${labels[action]} (${filterClient !== "ALL" ? "del cliente seleccionado" : "de todos los clientes"})?`)) return;

    let targetMonth: string | undefined;

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
              onClick={() => setMultiClientOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
              title="Crear la misma publicación en varios clientes con copy adaptado por IA"
            >
              👥 Multi-cliente
            </button>
            <button
              onClick={() => setOrphansOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
              title="Detecta publicaciones sin fecha, sin cliente, sin copy o sin imagen"
            >
              🩺 Diagnóstico
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
        <>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-2 mb-3">
            <StatCard label="Total mes" value={stats.total} accent="bg-brand-50 text-brand-700" />
            {STATUS_OPTIONS.map((s) => (
              <StatCard key={s.value} label={s.label} value={stats.byStatus[s.value] ?? 0} accent={s.color} />
            ))}
          </div>
          <details className="bg-white rounded-xl border mb-4">
            <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-slate-700 select-none">
              📊 Desglose detallado (red, formato, día de la semana)
            </summary>
            <div className="p-4 border-t space-y-4">
              {/* Por red */}
              {Object.keys(stats.byNetwork ?? {}).length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-700 mb-1.5">Publicaciones por red</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(stats.byNetwork as Record<string, number>)
                      .sort((a, b) => b[1] - a[1])
                      .map(([n, v]) => (
                        <div key={n} className="px-2.5 py-1 rounded-md border bg-slate-50 text-xs">
                          <span className="capitalize">{n}</span>{" "}
                          <span className="font-semibold text-slate-700">{v}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              {/* Por formato */}
              {Object.keys(stats.byFormat ?? {}).length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-700 mb-1.5">Publicaciones por formato</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(stats.byFormat as Record<string, number>)
                      .sort((a, b) => b[1] - a[1])
                      .map(([n, v]) => (
                        <div key={n} className="px-2.5 py-1 rounded-md border bg-slate-50 text-xs">
                          <span className="capitalize">{n}</span>{" "}
                          <span className="font-semibold text-slate-700">{v}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              {/* Matriz red × formato */}
              {stats.networkFormatMatrix && Object.keys(stats.networkFormatMatrix).length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-700 mb-1.5">Matriz red × formato</div>
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-2 py-1 text-slate-500 font-medium">Red</th>
                          {Array.from(
                            new Set(
                              Object.values(stats.networkFormatMatrix as Record<string, Record<string, number>>)
                                .flatMap((m) => Object.keys(m))
                            )
                          ).map((f) => (
                            <th key={f} className="text-center px-2 py-1 text-slate-500 font-medium capitalize">
                              {f}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(stats.networkFormatMatrix as Record<string, Record<string, number>>).map(
                          ([net, fmts]) => (
                            <tr key={net} className="border-t">
                              <td className="px-2 py-1 capitalize font-medium">{net}</td>
                              {Array.from(
                                new Set(
                                  Object.values(stats.networkFormatMatrix as Record<string, Record<string, number>>)
                                    .flatMap((m) => Object.keys(m))
                                )
                              ).map((f) => {
                                const v = fmts[f] ?? 0;
                                return (
                                  <td
                                    key={f}
                                    className={"text-center px-2 py-1 " + (v > 0 ? "bg-brand-50 text-brand-800 font-medium" : "text-slate-300")}
                                  >
                                    {v}
                                  </td>
                                );
                              })}
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* Día de la semana */}
              {Array.isArray(stats.byDayOfWeek) && (
                <div>
                  <div className="text-xs font-medium text-slate-700 mb-1.5">Publicaciones por día de la semana</div>
                  <div className="grid grid-cols-7 gap-1">
                    {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => {
                      const v = stats.byDayOfWeek[i] ?? 0;
                      const max = Math.max(...(stats.byDayOfWeek as number[]), 1);
                      const pct = Math.round((v / max) * 100);
                      return (
                        <div key={d} className="text-center">
                          <div className="h-16 flex items-end justify-center">
                            <div
                              className="w-6 bg-brand-500/70 rounded-t"
                              style={{ height: `${pct}%` }}
                              title={`${v} publicaciones`}
                            />
                          </div>
                          <div className="text-[10px] text-slate-500">{d}</div>
                          <div className="text-[10px] text-slate-700 font-medium">{v}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </details>
        </>
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
          <ApprovalLinkButton clientId={filterClient !== "ALL" ? filterClient : ""} month={month} />
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
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add("bg-brand-100/50");
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove("bg-brand-100/50");
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("bg-brand-100/50");
                    const postId = e.dataTransfer.getData("text/post-id");
                    const oldIso = e.dataTransfer.getData("text/orig-iso");
                    if (!postId || oldIso === iso) return;
                    // Mantener hora original; sólo cambiar la fecha
                    const orig = posts.find((p) => p.id === postId);
                    if (!orig?.scheduledFor) return;
                    const origDate = new Date(orig.scheduledFor);
                    const newDate = new Date(cell.date);
                    newDate.setUTCHours(origDate.getUTCHours(), origDate.getUTCMinutes(), 0, 0);
                    await fetch(`/api/v1/editorial/posts/${postId}/reschedule`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ scheduledFor: newDate.toISOString() })
                    });
                    load();
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
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/post-id", p.id);
                            e.dataTransfer.setData("text/orig-iso", iso);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(p);
                            setFormOpen(true);
                          }}
                          className={`block w-full text-left text-[11px] px-1.5 py-0.5 rounded border truncate ${st.color} hover:opacity-80 cursor-move`}
                          title={`${p.title} (arrastra para reprogramar)`}
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

      <DuplicateMonthModal
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        clients={clients}
        sourceMonth={month}
        defaultClientId={filterClient !== "ALL" ? filterClient : undefined}
        onDone={() => { setDuplicateOpen(false); load(); }}
      />

      <MultiClientPostModal
        open={multiClientOpen}
        onClose={() => setMultiClientOpen(false)}
        clients={clients}
        month={month}
        onDone={() => { setMultiClientOpen(false); load(); }}
      />

      <OrphansModal
        open={orphansOpen}
        onClose={() => setOrphansOpen(false)}
        onChanged={() => load()}
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
  const [count, setCount] = useState(14);
  const [networks, setNetworks] = useState<string[]>(["instagram", "facebook"]);
  const [mix, setMix] = useState({ imagen: 50, reel: 25, carrusel: 15, story: 10, video: 0 });
  const [copyLength, setCopyLength] = useState(50);
  const [perNetworkCopy, setPerNetworkCopy] = useState(false);
  const [extraGuidance, setExtraGuidance] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "REVIEW">("DRAFT");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!open) return;
    setClientId(clients[0]?.id ?? "");
    setCount(14);
    setNetworks(["instagram", "facebook"]);
    setMix({ imagen: 50, reel: 25, carrusel: 15, story: 10, video: 0 });
    setCopyLength(50);
    setPerNetworkCopy(false);
    setExtraGuidance("");
    setStatus("DRAFT");
    setError(null);
    setResult(null);
  }, [open, clients]);

  function toggle(n: string) {
    setNetworks((arr) => (arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n]));
  }

  const mixTotal = mix.imagen + mix.reel + mix.carrusel + mix.story + mix.video;
  const lengthLabel = copyLength < 25
    ? "ultra-directo (40-100 palabras)"
    : copyLength < 50
      ? "corto (60-180 palabras)"
      : copyLength < 75
        ? "medio (100-300 palabras)"
        : "largo (200-450 palabras)";

  async function run() {
    if (!clientId) {
      setError("Selecciona un cliente");
      return;
    }
    if (networks.length === 0) {
      setError("Selecciona al menos una red");
      return;
    }
    if (mixTotal === 0) {
      setError("El mix de formatos debe sumar > 0");
      return;
    }
    setRunning(true);
    setError(null);
    const r = await fetch("/api/v1/editorial/generate-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        month,
        count,
        networks,
        mix,
        copyLength,
        perNetworkCopy,
        extraGuidance: extraGuidance || undefined,
        status
      })
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
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Claude leerá el <strong>brief</strong>, los <strong>colores</strong>, los <strong>competidores</strong> y la
          <strong> guía de estilo</strong> del cliente, y generará {count} publicaciones para {month}.
        </p>

        <div className="grid grid-cols-2 gap-3">
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
            <label className="block text-xs font-medium text-slate-700 mb-1">Nº publicaciones</label>
            <input
              type="number"
              min={1}
              max={40}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value))))}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
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
          {networks.length > 1 && (
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={perNetworkCopy}
                onChange={(e) => setPerNetworkCopy(e.target.checked)}
                className="accent-violet-600"
              />
              Generar copy adaptado por cada red (más tokens pero más nativo)
            </label>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Mix de formatos · <span className="text-slate-500">total {mixTotal}%</span>
          </label>
          <div className="grid grid-cols-5 gap-2">
            {(["imagen", "reel", "carrusel", "story", "video"] as const).map((k) => (
              <div key={k} className="bg-slate-50 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-slate-700 capitalize">{k}</span>
                  <span className="text-[11px] text-violet-600 font-medium">{mix[k]}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={mix[k]}
                  onChange={(e) => setMix({ ...mix, [k]: Number(e.target.value) })}
                  className="w-full accent-violet-600"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Longitud del copy · <span className="text-violet-600">{copyLength}%</span> ({lengthLabel})
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={copyLength}
            onChange={(e) => setCopyLength(Number(e.target.value))}
            className="w-full accent-violet-600"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Instrucción extra (opcional)</label>
          <textarea
            value={extraGuidance}
            onChange={(e) => setExtraGuidance(e.target.value)}
            rows={3}
            placeholder="Ej. enfoca el mes en sostenibilidad. Incluye 2 testimonios. Evita hablar de precios."
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-700">Estado inicial</label>
          <div className="flex gap-2">
            {(["DRAFT", "REVIEW"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={
                  "px-3 py-1.5 rounded-md text-xs transition border " +
                  (status === s
                    ? "bg-violet-50 border-violet-300 text-violet-700 font-medium"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                }
              >
                {s === "DRAFT" ? "Borrador" : "Revisión"}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
        {result && (
          <p className="text-xs text-emerald-700">
            ✓ {result.count} publicaciones creadas con {result.model}. Cerrando…
          </p>
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
    networks: [] as string[],
    hashtags: "",
    firstComment: "",
    copyByNetwork: {} as Record<string, string>
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
      hashtags: prev.hashtags || (fullPost.hashtags ?? ""),
      firstComment: prev.firstComment || (fullPost.firstComment ?? ""),
      copyByNetwork:
        Object.keys(prev.copyByNetwork).length > 0
          ? prev.copyByNetwork
          : (fullPost.copyByNetwork as Record<string, string> | null) ?? {},
      networks:
        prev.networks.length > 0
          ? prev.networks
          : (() => {
              try {
                return JSON.parse(fullPost.networks);
              } catch {
                return [];
              }
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
        networks: nets,
        hashtags: post.hashtags ?? "",
        firstComment: post.firstComment ?? "",
        copyByNetwork: (post.copyByNetwork as Record<string, string> | null) ?? {}
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
        networks: ["instagram"],
        hashtags: "",
        firstComment: "",
        copyByNetwork: {}
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
      networks: form.networks,
      hashtags: form.hashtags || null,
      firstComment: form.firstComment || null,
      copyByNetwork: Object.keys(form.copyByNetwork).length > 0 ? form.copyByNetwork : null
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
    const copyByNet: Record<string, string> =
      (fullPost.copyByNetwork as Record<string, string> | null) ?? {};
    const netsWithOwnCopy = networks.filter((n) => (copyByNet[n] ?? "").trim());
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
                    className="w-full max-h-[560px] object-contain rounded-xl border bg-slate-50 hover:opacity-95 transition"
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
                {netsWithOwnCopy.length > 0 && (
                  <details className="mt-2 rounded-lg border bg-amber-50/40 border-amber-200">
                    <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-amber-900">
                      ✏️ Copy adaptado por red ({netsWithOwnCopy.length})
                    </summary>
                    <div className="px-3 py-2 border-t border-amber-200 bg-white space-y-2">
                      {netsWithOwnCopy.map((n) => (
                        <div key={n}>
                          <div className="text-[11px] font-semibold uppercase text-slate-500 mb-0.5">{n}</div>
                          <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                            {copyByNet[n]}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {fullPost.firstComment && fullPost.firstComment.trim() && (
                  <div className="mt-2">
                    <div className="text-[11px] font-semibold uppercase text-slate-500 mb-0.5">Primer comentario</div>
                    <div className="rounded-lg border bg-sky-50/40 border-sky-200 p-2.5 text-xs text-slate-700 whitespace-pre-wrap">
                      {fullPost.firstComment}
                    </div>
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
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Copy principal (común a todas las redes)</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={10}
            placeholder="Contenido completo de la publicación"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Copy por red (opcional, plegable) */}
        {form.networks.length > 0 && (
          <details className="rounded-lg border bg-slate-50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700 select-none">
              ✏️ Copy distinto por red ({Object.keys(form.copyByNetwork).filter((k) => (form.copyByNetwork[k] ?? "").trim()).length}/
              {form.networks.length} configurados)
            </summary>
            <div className="px-3 py-2 border-t bg-white space-y-2">
              <p className="text-[11px] text-slate-500">
                Si una red queda vacía, se usa el copy principal. Útil cuando el tono o el formato cambia entre IG y LinkedIn.
              </p>
              {form.networks.map((net) => (
                <div key={net}>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1 capitalize">{net}</label>
                  <textarea
                    value={form.copyByNetwork[net] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        copyByNetwork: { ...form.copyByNetwork, [net]: e.target.value }
                      })
                    }
                    rows={4}
                    placeholder={`Copy específico para ${net}. Vacío = se usa el copy principal.`}
                    className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              ))}
            </div>
          </details>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Hashtags</label>
          <textarea
            value={form.hashtags}
            onChange={(e) => setForm({ ...form, hashtags: e.target.value })}
            rows={2}
            placeholder="#hashtag1 #hashtag2 #hashtag3 …"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="mt-1 text-[11px] text-slate-500">Se incluyen al final del copy en el CSV de Metricool.</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Primer comentario (opcional)</label>
          <textarea
            value={form.firstComment}
            onChange={(e) => setForm({ ...form, firstComment: e.target.value })}
            rows={2}
            placeholder="Comentario que se publica auto al subir (útil para hashtags adicionales en IG)"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Acciones rápidas IA */}
        {isEdit && post && (
          <AiActionsBar
            postId={post.id}
            currentContent={form.content}
            currentHashtags={form.hashtags}
            onApplyContent={(v) => setForm((f) => ({ ...f, content: v }))}
            onApplyHashtags={(v) => setForm((f) => ({ ...f, hashtags: v }))}
          />
        )}

        {/* Generar imagen con IA */}
        {isEdit && post && (
          <GenerateImageBar postId={post.id} onGenerated={() => onSaved()} />
        )}

        {/* Re-aplicar overlay (logo + headlines) sobre imagen existente */}
        {isEdit && post && fullPost?.thumbnail && (
          <ReapplyOverlayBar
            postId={post.id}
            currentTitle={form.title}
            currentContent={form.content}
            onApplied={() => onSaved()}
          />
        )}

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

type AiActionKey =
  | "improve"
  | "casual"
  | "corporate"
  | "shorter"
  | "longer"
  | "hashtags"
  | "variants"
  | "translate_en"
  | "custom";

const AI_ACTION_BUTTONS: { key: AiActionKey; emoji: string; label: string }[] = [
  { key: "improve", emoji: "✍️", label: "Mejorar" },
  { key: "casual", emoji: "😊", label: "Casual" },
  { key: "corporate", emoji: "💼", label: "Corporate" },
  { key: "shorter", emoji: "📏", label: "Acortar" },
  { key: "longer", emoji: "📐", label: "Alargar" },
  { key: "hashtags", emoji: "#️⃣", label: "Hashtags" },
  { key: "variants", emoji: "🔀", label: "3 variantes" },
  { key: "translate_en", emoji: "🌐", label: "EN" }
];

function AiActionsBar({
  postId,
  currentContent,
  currentHashtags,
  onApplyContent,
  onApplyHashtags
}: {
  postId: string;
  currentContent: string;
  currentHashtags: string;
  onApplyContent: (v: string) => void;
  onApplyHashtags: (v: string) => void;
}) {
  const [running, setRunning] = useState<AiActionKey | null>(null);
  const [preview, setPreview] = useState<{ action: AiActionKey; result: string; variants?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  async function run(action: AiActionKey, customInstruction?: string) {
    setRunning(action);
    setError(null);
    setPreview(null);
    const r = await fetch(`/api/v1/editorial/posts/${postId}/ai-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, customInstruction, apply: false })
    });
    setRunning(null);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setPreview({ action, result: j.result, variants: j.variants });
  }

  function applyPreview(text?: string) {
    if (!preview) return;
    const v = text ?? preview.result;
    if (preview.action === "hashtags") {
      onApplyHashtags(v);
    } else {
      onApplyContent(v);
    }
    setPreview(null);
  }

  return (
    <div className="rounded-lg border bg-violet-50/40 border-violet-200 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-600" />
        <span className="text-xs font-semibold text-violet-900">Acciones rápidas con IA</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {AI_ACTION_BUTTONS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => run(b.key)}
            disabled={running !== null}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border bg-white hover:bg-violet-50 border-violet-200 text-violet-800 disabled:opacity-50"
          >
            {running === b.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>{b.emoji}</span>}
            {b.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Instrucción libre (ej. añade emoji al inicio)"
          className="flex-1 px-2 py-1 rounded-md border bg-white text-[11px] focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button
          type="button"
          onClick={() => custom.trim() && run("custom", custom)}
          disabled={running !== null || !custom.trim()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
        >
          {running === "custom" ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>✨</span>}
          Aplicar
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {preview && (
        <div className="rounded-md border bg-white p-2.5 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-violet-700 font-semibold">
            Resultado de "{AI_ACTION_BUTTONS.find((b) => b.key === preview.action)?.label ?? preview.action}"
          </div>
          {preview.variants && preview.variants.length > 0 ? (
            <div className="space-y-2">
              {preview.variants.map((v, i) => (
                <div key={i} className="rounded border bg-slate-50/60 p-2">
                  <div className="text-[10px] text-slate-500 mb-1">Variante {i + 1}</div>
                  <div className="text-xs whitespace-pre-wrap text-slate-800">{v}</div>
                  <button
                    type="button"
                    onClick={() => applyPreview(v)}
                    className="mt-1 text-[11px] text-violet-700 hover:underline"
                  >
                    Aplicar esta variante
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs whitespace-pre-wrap text-slate-800">{preview.result}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="text-[11px] text-slate-500 hover:text-slate-700"
            >
              Descartar
            </button>
            {!preview.variants && (
              <button
                type="button"
                onClick={() => applyPreview()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-violet-600 hover:bg-violet-700 text-white"
              >
                ✓ Sustituir en el form
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReapplyOverlayBar({
  postId,
  currentTitle,
  currentContent,
  onApplied
}: {
  postId: string;
  currentTitle: string;
  currentContent: string;
  onApplied: () => void;
}) {
  const [headline1, setHeadline1] = useState("");
  const [headline2, setHeadline2] = useState("");
  const [logoVisible, setLogoVisible] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setHeadline1(currentTitle.slice(0, 80));
    const firstSentence = currentContent.split(/[.!?\n]/)[0]?.trim();
    setHeadline2(firstSentence && firstSentence !== currentTitle ? firstSentence.slice(0, 80) : "");
  }, [currentTitle, currentContent]);

  async function run() {
    setRunning(true);
    setError(null);
    setDone(false);
    const headlines = [headline1, headline2].filter((s) => s.trim());
    const r = await fetch(`/api/v1/editorial/posts/${postId}/reapply-overlay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headlines, logoVisible })
    });
    setRunning(false);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setDone(true);
    onApplied();
  }

  return (
    <div className="rounded-lg border bg-amber-50/40 border-amber-200 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Pencil className="h-4 w-4 text-amber-600" />
        <span className="text-xs font-semibold text-amber-900">Re-aplicar overlay (logo + texto sobre la imagen actual)</span>
      </div>
      <p className="text-[11px] text-slate-600">
        Recompone la imagen ACTUAL con headlines y logo del cliente. Sin regenerar (rápido y gratis). Usa los colores
        y el patrón visual configurados en la ficha del cliente.
      </p>
      <input
        value={headline1}
        onChange={(e) => setHeadline1(e.target.value)}
        placeholder="Línea principal (grande)"
        className="w-full px-2 py-1.5 rounded-md border bg-white text-xs"
      />
      <input
        value={headline2}
        onChange={(e) => setHeadline2(e.target.value)}
        placeholder="Línea secundaria (opcional)"
        className="w-full px-2 py-1.5 rounded-md border bg-white text-xs"
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
          <input
            type="checkbox"
            checked={logoVisible}
            onChange={(e) => setLogoVisible(e.target.checked)}
            className="accent-amber-600"
          />
          Mostrar logo
        </label>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Re-aplicar overlay
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {done && <p className="text-[11px] text-emerald-700">✓ Overlay aplicado.</p>}
    </div>
  );
}

function GenerateImageBar({ postId, onGenerated }: { postId: string; onGenerated: () => void }) {
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    const r = await fetch(`/api/v1/editorial/posts/${postId}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality })
    });
    setRunning(false);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setLastUrl(j.url);
    onGenerated();
  }

  return (
    <div className="rounded-lg border bg-sky-50/40 border-sky-200 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-sky-600" />
        <span className="text-xs font-semibold text-sky-900">Generar imagen con IA (gpt-image-1)</span>
      </div>
      <p className="text-[11px] text-slate-600">
        Usa el brief, los colores y la guía de estilo del cliente. El formato y aspect ratio se decide por el tipo
        configurado en la ficha del cliente.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {(["low", "medium", "high"] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuality(q)}
              className={
                "px-2 py-1 rounded-md text-[11px] border " +
                (quality === q
                  ? "bg-sky-100 border-sky-300 text-sky-800 font-medium"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
              }
            >
              {q === "low" ? "Baja (~$0.02)" : q === "medium" ? "Media (~$0.04)" : "Alta (~$0.17)"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {running ? "Generando…" : "Generar imagen"}
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {lastUrl && (
        <div className="text-[11px] text-emerald-700">✓ Imagen generada y asociada al post.</div>
      )}
    </div>
  );
}

function OrphansModal({
  open,
  onClose,
  onChanged
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<{ orphans: any[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/editorial/orphans");
    if (r.ok) setData(await r.json());
    setLoading(false);
    setSelected(new Set());
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (!data) return;
    if (selected.size === data.orphans.length) setSelected(new Set());
    else setSelected(new Set(data.orphans.map((o) => o.id)));
  }

  async function repair(action: "delete" | "to_draft" | "set_default_date") {
    if (selected.size === 0) return;
    const labels: Record<string, string> = {
      delete: `borrar permanentemente ${selected.size} publicaciones`,
      to_draft: `pasar ${selected.size} publicaciones a borrador`,
      set_default_date: `asignar fecha (hoy) a ${selected.size} publicaciones`
    };
    if (!confirm(`¿Confirmas ${labels[action]}?`)) return;
    setBusy(true);
    const body: any = { ids: Array.from(selected), action };
    if (action === "set_default_date") body.defaultDate = new Date().toISOString();
    await fetch("/api/v1/editorial/orphans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setBusy(false);
    await load();
    onChanged();
  }

  return (
    <Modal open={open} onClose={onClose} title="🩺 Diagnóstico de publicaciones" size="xl">
      {loading ? (
        <div className="py-8 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Analizando…
        </div>
      ) : !data ? null : data.total === 0 ? (
        <div className="py-8 text-center text-sm">
          <div className="text-3xl mb-2">✅</div>
          <p className="text-slate-700 font-medium">Sin publicaciones huérfanas.</p>
          <p className="text-xs text-slate-500 mt-1">
            Todas tus publicaciones tienen fecha, cliente, copy, red e imagen.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-600">
              Encontradas <strong>{data.total}</strong> publicaciones con problemas.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-brand-600 hover:underline"
              >
                {selected.size === data.orphans.length ? "Deseleccionar todas" : "Seleccionar todas"}
              </button>
            </div>
          </div>
          <div className="rounded-lg border max-h-[400px] overflow-y-auto bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left w-8"></th>
                  <th className="px-2 py-2 text-left">Título</th>
                  <th className="px-2 py-2 text-left">Cliente</th>
                  <th className="px-2 py-2 text-left">Problemas</th>
                  <th className="px-2 py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.orphans.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                        className="accent-brand-600"
                      />
                    </td>
                    <td className="px-2 py-1.5 truncate max-w-xs" title={o.title}>{o.title}</td>
                    <td className="px-2 py-1.5 text-slate-600">{o.client?.name ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {o.issues.map((i: string) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-rose-50 text-rose-700 border border-rose-200"
                          >
                            {i.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => repair("to_draft")}
              disabled={busy || selected.size === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-xs disabled:opacity-50"
            >
              ↩️ A borrador ({selected.size})
            </button>
            <button
              type="button"
              onClick={() => repair("set_default_date")}
              disabled={busy || selected.size === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-xs disabled:opacity-50"
            >
              📅 Asignar fecha hoy ({selected.size})
            </button>
            <button
              type="button"
              onClick={() => repair("delete")}
              disabled={busy || selected.size === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 text-xs disabled:opacity-50 ml-auto"
            >
              🗑️ Borrar ({selected.size})
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DuplicateMonthModal({
  open,
  onClose,
  clients,
  sourceMonth,
  defaultClientId,
  onDone
}: {
  open: boolean;
  onClose: () => void;
  clients: UiClient[];
  sourceMonth: string;
  defaultClientId?: string;
  onDone: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [resetStatus, setResetStatus] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId ?? clients[0]?.id ?? "");
    // mes siguiente como sugerencia
    const [y, m] = sourceMonth.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1));
    setTargetMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
    setResetStatus(true);
    setRunning(false);
    setError(null);
    setResult(null);
  }, [open, defaultClientId, clients, sourceMonth]);

  async function run() {
    if (!clientId) {
      setError("Selecciona un cliente");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      setError("Formato de mes destino inválido (YYYY-MM)");
      return;
    }
    setRunning(true);
    setError(null);
    const r = await fetch("/api/v1/editorial/duplicate-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, sourceMonth, targetMonth, resetStatus })
    });
    setRunning(false);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setResult(j);
    setTimeout(() => onDone(), 1500);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Duplicar mes — ${sourceMonth}`}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
          <button
            onClick={run}
            disabled={running || !clientId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Duplicar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Copia todas las publicaciones del cliente en <strong>{sourceMonth}</strong> al mes destino, manteniendo
          copy, hashtags, copy por red, formato e imagen.
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
          <label className="block text-xs font-medium text-slate-700 mb-1">Mes destino *</label>
          <input
            type="month"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={resetStatus}
            onChange={(e) => setResetStatus(e.target.checked)}
            className="accent-brand-600"
          />
          Crear todas como borrador (recomendado)
        </label>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {result && (
          <p className="text-xs text-emerald-700">
            ✓ {result.created} publicaciones duplicadas al mes {targetMonth}.
          </p>
        )}
      </div>
    </Modal>
  );
}

function MultiClientPostModal({
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
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [format, setFormat] = useState("imagen");
  const [networks, setNetworks] = useState<string[]>(["instagram", "facebook"]);
  const [adaptCopy, setAdaptCopy] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!open) return;
    setClientIds([]);
    setTitle("");
    setContent("");
    setHashtags("");
    setFirstComment("");
    setScheduledFor(`${month}-15T10:00`);
    setFormat("imagen");
    setNetworks(["instagram", "facebook"]);
    setAdaptCopy(true);
    setRunning(false);
    setError(null);
    setResult(null);
  }, [open, month]);

  function toggleClient(id: string) {
    setClientIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  }
  function toggleNet(n: string) {
    setNetworks((arr) => (arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n]));
  }

  async function run() {
    if (clientIds.length === 0) {
      setError("Selecciona al menos un cliente");
      return;
    }
    if (!title.trim() || !content.trim() || !scheduledFor) {
      setError("Faltan título, copy o fecha");
      return;
    }
    setRunning(true);
    setError(null);
    const r = await fetch("/api/v1/editorial/multi-client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientIds,
        title,
        content,
        hashtags: hashtags || undefined,
        firstComment: firstComment || undefined,
        scheduledFor: new Date(scheduledFor).toISOString(),
        format,
        networks,
        adaptCopy
      })
    });
    setRunning(false);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setResult(j);
    setTimeout(() => onDone(), 1500);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publicación multi-cliente"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
          <button
            onClick={run}
            disabled={running || clientIds.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear en {clientIds.length} cliente{clientIds.length !== 1 ? "s" : ""}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Crea la misma publicación en varios clientes a la vez (ej: día de la madre, Black Friday). Si activas
          "adaptar copy con IA", Claude reescribirá el copy al tono de cada cliente usando su brief.
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Clientes destino</label>
          <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border bg-slate-50 max-h-40 overflow-y-auto">
            {clients.map((c) => {
              const sel = clientIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleClient(c.id)}
                  className={
                    "px-2.5 py-1 rounded-md text-xs transition border " +
                    (sel
                      ? "bg-brand-50 border-brand-300 text-brand-700 font-medium"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título (interno)"
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          placeholder="Copy base — se adaptará al tono de cada cliente si activas la opción de abajo"
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className="px-3 py-2 rounded-lg border bg-white text-sm"
          />
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="px-3 py-2 rounded-lg border bg-white text-sm"
          >
            {["imagen", "reel", "carrusel", "story", "video"].map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Redes</label>
          <div className="flex flex-wrap gap-1.5">
            {NETWORK_OPTIONS.map((n) => {
              const sel = networks.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleNet(n)}
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
        <textarea
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          rows={2}
          placeholder="Hashtags (compartidos por todos los clientes)"
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
        />
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={adaptCopy}
            onChange={(e) => setAdaptCopy(e.target.checked)}
            className="accent-brand-600"
          />
          Adaptar copy al tono de cada cliente con IA (recomendado)
        </label>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {result && (
          <p className="text-xs text-emerald-700">
            ✓ Creadas {result.created} publicaciones {result.adapted && "con copy adaptado por IA"}.
          </p>
        )}
      </div>
    </Modal>
  );
}

function ApprovalLinkButton({ clientId, month }: { clientId: string; month: string }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [links, setLinks] = useState<any[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function load() {
    if (!clientId) return;
    const r = await fetch(`/api/v1/editorial/approval-links?clientId=${clientId}&month=${month}`);
    if (r.ok) {
      const j = await r.json();
      setLinks(j.items ?? []);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open, clientId, month]);

  async function create() {
    setCreating(true);
    const r = await fetch(`/api/v1/editorial/approval-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, month, expiresInDays: 30 })
    });
    setCreating(false);
    if (r.ok) load();
  }

  async function revoke(id: string) {
    if (!confirm("¿Revocar este link? El cliente dejará de poder entrar.")) return;
    await fetch(`/api/v1/editorial/approval-links/${id}`, { method: "DELETE" });
    load();
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/p/editorial/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 1500);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!clientId}
        title={clientId ? "Compartir mes con el cliente" : "Filtra por un cliente para generar el link"}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
      >
        🔗 Link cliente
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Link de aprobación para el cliente" size="md">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Genera un enlace para que el cliente vea y apruebe las publicaciones de <strong>{month}</strong> sin entrar al hub.
          </p>
          {links.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-center">
              <p className="text-xs text-slate-500 mb-3">Aún no hay link generado para este mes.</p>
              <button
                type="button"
                onClick={create}
                disabled={creating || !clientId}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                Generar link
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {links.map((l) => {
                const url = `${typeof window !== "undefined" ? window.location.origin : ""}/p/editorial/${l.token}`;
                return (
                  <div key={l.id} className="rounded-lg border bg-slate-50/60 p-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={url}
                        onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                        className="flex-1 px-2 py-1.5 rounded border bg-white text-xs font-mono focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => copyLink(l.token)}
                        className="px-2 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-xs"
                      >
                        {copiedToken === l.token ? "✓ Copiado" : "Copiar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => revoke(l.id)}
                        className="px-2 py-1.5 rounded-md border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 text-xs"
                      >
                        Revocar
                      </button>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      Creado {new Date(l.createdAt).toLocaleString("es-ES")}
                      {l.expiresAt && <> · caduca {new Date(l.expiresAt).toLocaleDateString("es-ES")}</>}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={create}
                disabled={creating}
                className="text-xs text-brand-600 hover:underline disabled:opacity-50"
              >
                + Generar otro link
              </button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

