"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import EditorialJobsToast from "@/components/admin/EditorialJobsToast";
import AdminPostThread from "@/components/editorial/AdminPostThread";
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
  CheckCheck,
  Search,
  X,
  ChevronDown
} from "lucide-react";
import type { UiClient } from "@/lib/db/queries";
import { VISUAL_PATTERNS } from "@/lib/editorial/client-meta";

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
  visualPattern?: string | null;
  patternStrength?: number | null;
  patternTemplateId?: string | null;
  aspectRatio?: string | null;
  copyByNetwork?: Record<string, string> | null;
  metaJson?: any;
  revisions?: Array<{
    id: string;
    body: string | null;
    changeSummary: string | null;
    createdAt: string;
    authorId: string | null;
  }>;
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

/** Detecta si una URL de media es un vídeo (ignora el query string de las
 *  URLs firmadas de R2/S3). */
function isVideoUrl(url: string): boolean {
  if (!url) return false;
  const path = url.split("?")[0].toLowerCase();
  return /\.(mp4|webm|mov|m4v)$/.test(path);
}

function formatIcon(format: string | null) {
  const f = (format ?? "").toLowerCase();
  if (f.includes("reel") || f.includes("video")) return Film;
  if (f.includes("story") || f.includes("historia")) return Video;
  if (f.includes("blog") || f.includes("articulo")) return FileTextIcon;
  return ImageIcon;
}

// Estilo por formato: color de fondo + texto + dot + label, para que cada
// tipo de publicación sea reconocible de un vistazo en el calendario.
const FORMAT_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  imagen:   { bg: "bg-sky-50 border-sky-200",       text: "text-sky-800",      dot: "bg-sky-500",      label: "Imagen" },
  post:     { bg: "bg-sky-50 border-sky-200",       text: "text-sky-800",      dot: "bg-sky-500",      label: "Imagen" },
  reel:     { bg: "bg-pink-50 border-pink-200",     text: "text-pink-800",     dot: "bg-pink-500",     label: "Reel" },
  video:    { bg: "bg-rose-50 border-rose-200",     text: "text-rose-800",     dot: "bg-rose-500",     label: "Video" },
  carrusel: { bg: "bg-violet-50 border-violet-200", text: "text-violet-800",   dot: "bg-violet-500",   label: "Carrusel" },
  carousel: { bg: "bg-violet-50 border-violet-200", text: "text-violet-800",   dot: "bg-violet-500",   label: "Carrusel" },
  story:    { bg: "bg-amber-50 border-amber-200",   text: "text-amber-800",    dot: "bg-amber-500",    label: "Story" },
  blog:     { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", dot: "bg-emerald-500", label: "Blog" },
  email:    { bg: "bg-indigo-50 border-indigo-200", text: "text-indigo-800",   dot: "bg-indigo-500",   label: "Email" }
};

function formatStyle(format: string | null) {
  const f = (format ?? "imagen").toLowerCase();
  return FORMAT_STYLES[f] ?? FORMAT_STYLES.imagen;
}

// Considera "aprobado" cualquier estado igual o posterior a APPROVED
function isApprovedStatus(status: string): boolean {
  return ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(status);
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
  // Filtro de cliente persistente entre vistas / modales / navegación: se
  // hidrata desde localStorage al montar y se guarda cada vez que cambia.
  const [filterClient, setFilterClient] = useState(() => {
    if (typeof window === "undefined") return "ALL";
    try {
      return localStorage.getItem("editorial.filterClient") ?? "ALL";
    } catch {
      return "ALL";
    }
  });
  useEffect(() => {
    try {
      if (filterClient && filterClient !== "ALL") {
        localStorage.setItem("editorial.filterClient", filterClient);
      } else {
        localStorage.removeItem("editorial.filterClient");
      }
    } catch {}
  }, [filterClient]);
  const [filterFormat, setFilterFormat] = useState("ALL");
  const [formOpen, setFormOpen] = useState(false);
  // Fecha preseleccionada cuando se abre el modal tras clic en un día del
  // calendario (YYYY-MM-DD). null = modo manual / botón "Nueva publicación".
  const [newPostDate, setNewPostDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditorialPost | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [metricoolOpen, setMetricoolOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [multiClientOpen, setMultiClientOpen] = useState(false);
  const [orphansOpen, setOrphansOpen] = useState(false);
  const [competitorsOpen, setCompetitorsOpen] = useState(false);
  const [editorialSettingsOpen, setEditorialSettingsOpen] = useState(false);
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
      // limit=500 (max) para traer TODOS los clientes — sin esto el
      // default 50 corta y se pierden los creados primero (Clinica
      // March, etc.) tras importar los 71 del sheet.
      fetch("/api/v1/clients?limit=500"),
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

  const filtered = posts.filter(
    (p) =>
      (filterStatus === "ALL" || p.status === filterStatus) &&
      (filterFormat === "ALL" || (p.format ?? "imagen").toLowerCase() === filterFormat)
  );

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
              onClick={() => setCompetitorsOpen(true)}
              disabled={filterClient === "ALL"}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm disabled:opacity-50"
              title={filterClient === "ALL" ? "Filtra por un cliente para analizar su competencia" : "Analizar competencia con IA"}
            >
              🔍 Competencia
            </button>
            <button
              onClick={() => setOrphansOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
              title="Detecta publicaciones sin fecha, sin cliente, sin copy o sin imagen"
            >
              🩺 Diagnóstico
            </button>
            <button
              onClick={() => setEditorialSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
              title="Webhook Make y otras opciones del módulo editorial"
            >
              ⚙️
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

        <ClientFilterCombobox
          clients={clients}
          value={filterClient}
          onChange={setFilterClient}
        />
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
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs">
          <span className="text-slate-500">Formato:</span>
          <select
            value={filterFormat}
            onChange={(e) => setFilterFormat(e.target.value)}
            className="bg-transparent font-medium focus:outline-none"
          >
            <option value="ALL">Todos</option>
            <option value="imagen">Imagen</option>
            <option value="reel">Reel</option>
            <option value="carrusel">Carrusel</option>
            <option value="story">Story</option>
            <option value="video">Video</option>
            <option value="blog">Blog</option>
            <option value="email">Email</option>
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
          {/* Leyenda de formatos */}
          <div className="flex flex-wrap gap-2 px-3 py-2 border-b bg-slate-50/50 text-[10px]">
            <span className="text-slate-500 uppercase tracking-wide">Leyenda:</span>
            {(["imagen", "reel", "carrusel", "story", "video"] as const).map((k) => {
              const fs = FORMAT_STYLES[k];
              return (
                <span key={k} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${fs.bg} ${fs.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${fs.dot}`} />
                  {fs.label}
                </span>
              );
            })}
            <span className="ml-2 text-slate-400">·</span>
            <span className="text-slate-500">✓ checkbox para aprobar · arrastra para reprogramar</span>
          </div>
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
                    setNewPostDate(iso);
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
                      const fs = formatStyle(p.format);
                      const Icon = formatIcon(p.format);
                      const approved = isApprovedStatus(p.status);
                      const st = STATUS_OPTIONS.find((s) => s.value === p.status) ?? STATUS_OPTIONS[0];
                      const isPublished = p.status === "PUBLISHED";
                      const isScheduled = p.status === "SCHEDULED";
                      return (
                        <div
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
                          className={`group flex items-center gap-1 text-[11px] px-1 py-0.5 rounded border ${fs.bg} ${fs.text} hover:opacity-80 cursor-move`}
                          title={`${p.title} · ${fs.label} · ${st.label} (arrastra para reprogramar)`}
                        >
                          <input
                            type="checkbox"
                            checked={approved}
                            onClick={(e) => e.stopPropagation()}
                            onChange={async (e) => {
                              e.stopPropagation();
                              const checked = e.currentTarget.checked;
                              await fetch(`/api/v1/editorial/posts/${p.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: checked ? "APPROVED" : "DRAFT" })
                              });
                              load();
                            }}
                            className="h-3 w-3 shrink-0 accent-emerald-600"
                            title={approved ? "Desaprobar" : "Aprobar"}
                          />
                          <Icon className="h-3 w-3 shrink-0 opacity-75" />
                          <span className="flex-1 min-w-0">
                            <span className="truncate block">{p.title}</span>
                            {filterClient === "ALL" && p.client && (
                              <Link
                                href={`/clientes/${p.client.id}`}
                                draggable={false}
                                onClick={(e) => e.stopPropagation()}
                                className="truncate block text-[10px] opacity-70 hover:underline"
                                title="Ver ficha del cliente"
                              >
                                {p.client.name}
                              </Link>
                            )}
                          </span>
                          {isPublished && <span className="shrink-0 text-emerald-600" title="Publicada">●</span>}
                          {isScheduled && <span className="shrink-0 text-indigo-600" title="Programada">▶</span>}
                        </div>
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
          <CalendarTrashZone onDropped={() => load()} />
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
                    <td className="px-3 py-3 text-slate-600">
                      {p.client ? (
                        <Link
                          href={`/clientes/${p.client.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-brand-600 hover:text-brand-700 hover:underline"
                          title="Ver ficha del cliente"
                        >
                          {p.client.name}
                        </Link>
                      ) : "—"}
                    </td>
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
        onClose={() => { setFormOpen(false); setNewPostDate(null); }}
        post={editing}
        clients={clients}
        defaultMonth={month}
        defaultClientId={filterClient !== "ALL" ? filterClient : undefined}
        defaultDateIso={newPostDate ?? undefined}
        onSaved={() => { setFormOpen(false); setNewPostDate(null); load(); }}
      />

      <GenerateMonthModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        clients={clients}
        month={month}
        defaultClientId={filterClient !== "ALL" ? filterClient : undefined}
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
        defaultClientId={filterClient !== "ALL" ? filterClient : undefined}
        onDone={() => { setMultiClientOpen(false); load(); }}
      />

      <OrphansModal
        open={orphansOpen}
        onClose={() => setOrphansOpen(false)}
        onChanged={() => load()}
      />

      <CompetitorsModal
        open={competitorsOpen}
        onClose={() => setCompetitorsOpen(false)}
        clientId={filterClient !== "ALL" ? filterClient : ""}
      />

      <EditorialSettingsModal
        open={editorialSettingsOpen}
        onClose={() => setEditorialSettingsOpen(false)}
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

      <EditorialJobsToast onJobCompleted={() => load()} />
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
          Genera un CSV con las publicaciones del calendario en el formato que el importador de Metricool acepta (una fila por publicación; las redes van marcadas con TRUE/FALSE). Puedes <strong>descargarlo y subirlo manualmente</strong>, o <strong>mandártelo por email</strong> si Resend está configurado. Al importar en Metricool, elige el formato de fecha <strong>YYYY-MM-DD</strong> y de hora <strong>HH:MM:SS</strong>.
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
  defaultClientId,
  onDone
}: {
  open: boolean;
  onClose: () => void;
  clients: UiClient[];
  month: string;
  defaultClientId?: string;
  onDone: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [count, setCount] = useState(14);
  const [networks, setNetworks] = useState<string[]>(["instagram", "facebook"]);
  const [mix, setMix] = useState({ imagen: 50, reel: 25, carrusel: 15, story: 10, video: 0 });
  const [copyLength, setCopyLength] = useState(50);
  // Por defecto activado (recomendación del usuario) — copy nativo por red
  // suele dar mejor resultado y los pocos tokens extra valen la pena.
  const [perNetworkCopy, setPerNetworkCopy] = useState(true);
  const [extraGuidance, setExtraGuidance] = useState("");
  const [imageIncludeHint, setImageIncludeHint] = useState("");
  const [imageAvoidHint, setImageAvoidHint] = useState("");
  // Pillars temáticos. Sliders 0-100 con valores no normalizados —
  // backend normaliza. Default razonable.
  const [pillars, setPillars] = useState({ educativo: 30, producto: 30, testimonio: 20, social: 20 });
  // Días de la semana permitidos (0=domingo..6=sábado). Default lun-vie.
  const [allowedDays, setAllowedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  // Horas preferidas. Default plugin (10/12/18).
  const [preferredHours, setPreferredHours] = useState<number[]>([10, 12, 18]);
  // Personas del roster que SÍ deben aparecer (forzadas).
  const [forcedRoster, setForcedRoster] = useState<string[]>([]);
  const [rosterOptions, setRosterOptions] = useState<string[]>([]);
  const [status, setStatus] = useState<"DRAFT" | "REVIEW">("DRAFT");
  // Pedido por el usuario: la generación de imagen siempre marcada por
  // defecto.
  const [generateImages, setGenerateImages] = useState(true);
  const [imageQuality, setImageQuality] = useState<"low" | "medium" | "high">("medium");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  // Preset persistido por cliente: cuando cambia clientId, hacemos GET de
  // /editorial-meta y aplicamos editorialDefaults si existe.
  const [presetLoaded, setPresetLoaded] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetSavedMsg, setPresetSavedMsg] = useState<string | null>(null);

  // Aplica un preset (parcial) sobre los estados, ignorando keys ausentes.
  function applyPreset(p: any) {
    if (!p || typeof p !== "object") return;
    if (typeof p.count === "number") setCount(Math.max(1, Math.min(40, p.count)));
    if (Array.isArray(p.networks) && p.networks.length > 0) setNetworks(p.networks);
    if (p.mix && typeof p.mix === "object") {
      setMix({
        imagen: Number(p.mix.imagen ?? 50),
        reel: Number(p.mix.reel ?? 25),
        carrusel: Number(p.mix.carrusel ?? 15),
        story: Number(p.mix.story ?? 10),
        video: Number(p.mix.video ?? 0)
      });
    }
    if (typeof p.copyLength === "number") setCopyLength(Math.max(0, Math.min(100, p.copyLength)));
    if (typeof p.perNetworkCopy === "boolean") setPerNetworkCopy(p.perNetworkCopy);
    if (typeof p.extraGuidance === "string") setExtraGuidance(p.extraGuidance);
    if (typeof p.imageIncludeHint === "string") setImageIncludeHint(p.imageIncludeHint);
    if (typeof p.imageAvoidHint === "string") setImageAvoidHint(p.imageAvoidHint);
    if (p.pillars && typeof p.pillars === "object") {
      setPillars({
        educativo: Number(p.pillars.educativo ?? 30),
        producto: Number(p.pillars.producto ?? 30),
        testimonio: Number(p.pillars.testimonio ?? 20),
        social: Number(p.pillars.social ?? 20)
      });
    }
    if (Array.isArray(p.allowedDays)) setAllowedDays(p.allowedDays.filter((d: any) => Number.isInteger(d) && d >= 0 && d <= 6));
    if (Array.isArray(p.preferredHours)) setPreferredHours(p.preferredHours.filter((h: any) => Number.isInteger(h) && h >= 0 && h <= 23));
    if (Array.isArray(p.forcedRoster)) setForcedRoster(p.forcedRoster.filter((n: any) => typeof n === "string"));
    if (p.status === "DRAFT" || p.status === "REVIEW") setStatus(p.status);
    if (typeof p.generateImages === "boolean") setGenerateImages(p.generateImages);
    if (p.imageQuality === "low" || p.imageQuality === "medium" || p.imageQuality === "high") {
      setImageQuality(p.imageQuality);
    }
  }

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId ?? clients[0]?.id ?? "");
    setCount(14);
    setNetworks(["instagram", "facebook"]);
    setMix({ imagen: 50, reel: 25, carrusel: 15, story: 10, video: 0 });
    setCopyLength(50);
    setPerNetworkCopy(true);
    setExtraGuidance("");
    setImageIncludeHint("");
    setImageAvoidHint("");
    setPillars({ educativo: 30, producto: 30, testimonio: 20, social: 20 });
    setAllowedDays([1, 2, 3, 4, 5]);
    setPreferredHours([10, 12, 18]);
    setForcedRoster([]);
    setRosterOptions([]);
    setStatus("DRAFT");
    setGenerateImages(true);
    setImageQuality("medium");
    setError(null);
    setResult(null);
    setPresetLoaded(false);
    setPresetSavedMsg(null);
  }, [open, clients]);

  // Cuando cambia el cliente seleccionado, traemos sus editorialDefaults
  // y los aplicamos encima del estado actual.
  useEffect(() => {
    if (!open || !clientId) return;
    let aborted = false;
    setPresetLoaded(false);
    fetch(`/api/v1/clients/${clientId}/editorial-meta`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (aborted) return;
        applyPreset(data?.editorialDefaults);
        // Roster: extraemos nombres únicos de referenceImages que tengan
        // personName, para pintar los chips de "personas a forzar".
        const refs: any[] = Array.isArray(data?.referenceImages) ? data.referenceImages : [];
        const names = Array.from(
          new Set(
            refs
              .map((r) => (r?.personName ?? "").toString().trim())
              .filter((n: string) => n.length > 0)
          )
        );
        setRosterOptions(names);
        setPresetLoaded(true);
      })
      .catch(() => setPresetLoaded(true));
    return () => {
      aborted = true;
    };
  }, [open, clientId]);

  async function savePreset() {
    if (!clientId) return;
    setSavingPreset(true);
    setPresetSavedMsg(null);
    const preset = {
      count,
      networks,
      mix,
      copyLength,
      perNetworkCopy,
      extraGuidance,
      imageIncludeHint,
      imageAvoidHint,
      pillars,
      allowedDays,
      preferredHours,
      forcedRoster,
      status,
      generateImages,
      imageQuality
    };
    try {
      const r = await fetch(`/api/v1/clients/${clientId}/editorial-meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editorialDefaults: preset })
      });
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        setPresetSavedMsg(`Error: ${data?.error?.message ?? r.status}`);
      } else {
        setPresetSavedMsg("Preset guardado para este cliente ✓");
      }
    } catch (e) {
      setPresetSavedMsg(`Error: ${(e as Error).message}`);
    } finally {
      setSavingPreset(false);
      setTimeout(() => setPresetSavedMsg(null), 3500);
    }
  }

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

  // Estimación de coste. Modelo simple:
  //   - Claude (entrada+salida): ~$0.02/post de media (Opus, copy
  //     estructurado + headlines + image_prompt)
  //   - Imagen: low=$0.02 · medium=$0.04 · high=$0.17 por imagen
  // Sirve para que el user no dispare un "high × 30 pubs" sin querer.
  const imgPerUnit = imageQuality === "low" ? 0.02 : imageQuality === "high" ? 0.17 : 0.04;
  const claudeCost = count * 0.02;
  const imageCost = generateImages ? count * imgPerUnit : 0;
  const totalCost = claudeCost + imageCost;

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
    if (allowedDays.length === 0) {
      setError("Selecciona al menos un día de la semana permitido");
      return;
    }
    if (preferredHours.length === 0) {
      setError("Selecciona al menos una hora preferida");
      return;
    }
    setRunning(true);
    setError(null);
    // Mapeamos pillars del UI (keys españolas) a tal cual al backend —
    // se normalizan allí.
    const pillarsBody = Object.fromEntries(
      Object.entries(pillars).filter(([, v]) => v > 0)
    );
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
        imageIncludeHint: imageIncludeHint || undefined,
        imageAvoidHint: imageAvoidHint || undefined,
        pillars: Object.keys(pillarsBody).length > 0 ? pillarsBody : undefined,
        allowedDaysOfWeek: allowedDays.length === 7 ? undefined : allowedDays,
        preferredHours,
        useRosterPersons: forcedRoster.length > 0 ? forcedRoster : undefined,
        status,
        generateImages,
        imageQuality
      })
    });
    setRunning(false);
    const data = await r.json();
    if (!r.ok) {
      setError(data?.error?.message ?? `Error ${r.status}`);
      return;
    }
    // El backend devuelve un jobId que se procesa en segundo plano.
    // Persistimos en localStorage y emitimos evento custom para que el
    // toast global haga polling. Cerramos el modal de inmediato.
    try {
      const existing = JSON.parse(localStorage.getItem("editorial.runningJobs") ?? "[]");
      existing.push({ id: data.jobId, startedAt: Date.now(), clientName: clients.find((c) => c.id === clientId)?.name, month });
      localStorage.setItem("editorial.runningJobs", JSON.stringify(existing));
      window.dispatchEvent(new CustomEvent("editorial:job-started", { detail: { id: data.jobId } }));
    } catch {}
    setResult({ count: count, model: "background", jobId: data.jobId });
    setTimeout(() => onDone(), 600);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Generar mes con IA — ${month}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={savePreset}
              disabled={!clientId || savingPreset}
              title="Guardar la configuración actual como predeterminada para este cliente"
              className="px-3 py-2 rounded-lg text-xs border bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              {savingPreset ? "Guardando…" : "Guardar preset para cliente"}
            </button>
            {presetSavedMsg && (
              <span className={"text-xs " + (presetSavedMsg.startsWith("Error") ? "text-red-600" : "text-emerald-700")}>
                {presetSavedMsg}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
            <button
              onClick={run}
              disabled={running || !clientId}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generar
            </button>
          </div>
        </div>
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
            <ClientPickerCombobox
              clients={clients}
              value={clientId}
              onChange={(id) => setClientId(id)}
              placeholder="Selecciona…"
            />
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

        {/* Imagen IA */}
        <div className="rounded-lg border bg-sky-50/40 border-sky-200 p-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={generateImages}
              onChange={(e) => setGenerateImages(e.target.checked)}
              className="accent-sky-600"
            />
            <span className="font-medium text-sky-900">Generar también imagen IA para cada publicación</span>
          </label>
          <p className="mt-1 text-[11px] text-slate-600 ml-6">
            Llama a gpt-image-1 con el brief, colores y guía de estilo del cliente. Requiere OpenAI API key + R2 (
            <code className="text-[10px]">STORAGE_*</code>). Si falla en alguna, el job continúa.
          </p>
          {generateImages && (
            <div className="mt-2 ml-6 flex gap-1">
              {(["low", "medium", "high"] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setImageQuality(q)}
                  className={
                    "px-2 py-1 rounded-md text-[11px] border " +
                    (imageQuality === q
                      ? "bg-sky-100 border-sky-300 text-sky-800 font-medium"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {q === "low" ? "Baja (~$0.02)" : q === "medium" ? "Media (~$0.04)" : "Alta (~$0.17)"}
                </button>
              ))}
            </div>
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

        {/* Pillars temáticos */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Pillars temáticos <span className="text-slate-500">· se reparten proporcionalmente</span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(["educativo", "producto", "testimonio", "social"] as const).map((k) => (
              <div key={k} className="bg-slate-50 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-slate-700 capitalize">{k}</span>
                  <span className="text-[11px] text-violet-600 font-medium">{pillars[k]}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={pillars[k]}
                  onChange={(e) => setPillars({ ...pillars, [k]: Number(e.target.value) })}
                  className="w-full accent-violet-600"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Días permitidos + horas preferidas */}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Días permitidos
              {allowedDays.length === 7 && <span className="ml-1 text-[11px] text-slate-500">· todos</span>}
            </label>
            <div className="flex flex-wrap gap-1">
              {[
                { d: 1, label: "L" },
                { d: 2, label: "M" },
                { d: 3, label: "X" },
                { d: 4, label: "J" },
                { d: 5, label: "V" },
                { d: 6, label: "S" },
                { d: 0, label: "D" }
              ].map(({ d, label }) => {
                const sel = allowedDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setAllowedDays((prev) =>
                        prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
                      )
                    }
                    className={
                      "w-8 h-8 rounded-md text-xs font-medium border " +
                      (sel
                        ? "bg-violet-50 border-violet-300 text-violet-700"
                        : "bg-white border-slate-200 text-slate-400 hover:bg-slate-50")
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Horas preferidas
            </label>
            <div className="flex flex-wrap gap-1">
              {[8, 9, 10, 11, 12, 14, 16, 18, 20, 21].map((h) => {
                const sel = preferredHours.includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() =>
                      setPreferredHours((prev) =>
                        prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h].sort((a, b) => a - b)
                      )
                    }
                    className={
                      "px-2 py-1 rounded-md text-[11px] font-medium border tabular-nums " +
                      (sel
                        ? "bg-violet-50 border-violet-300 text-violet-700"
                        : "bg-white border-slate-200 text-slate-400 hover:bg-slate-50")
                    }
                  >
                    {h.toString().padStart(2, "0")}h
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Personas del roster forzadas */}
        {rosterOptions.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Personas del roster forzadas <span className="text-slate-500">· deben aparecer en TODAS las imágenes</span>
            </label>
            <div className="flex flex-wrap gap-1">
              {rosterOptions.map((name) => {
                const sel = forcedRoster.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() =>
                      setForcedRoster((prev) =>
                        prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
                      )
                    }
                    className={
                      "px-2.5 py-1 rounded-md text-xs transition border " +
                      (sel
                        ? "bg-violet-50 border-violet-300 text-violet-700 font-medium"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                    }
                  >
                    {sel ? "✓ " : ""}{name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Si no marcas nadie, Claude detecta personas auto-mágicamente por mención en el copy (incluye "equipo" → todo el roster type=equipo).
            </p>
          </div>
        )}

        {/* Guías de imagen positivo/negativo */}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-emerald-800 mb-1">
              Qué SÍ debe aparecer (positivo, opcional)
            </label>
            <textarea
              value={imageIncludeHint}
              onChange={(e) => setImageIncludeHint(e.target.value)}
              rows={2}
              placeholder="Ej. ambiente luminoso, vegetación, instrumentos médicos modernos…"
              className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-rose-800 mb-1">
              Qué NO debe aparecer (negativo, opcional)
            </label>
            <textarea
              value={imageAvoidHint}
              onChange={(e) => setImageAvoidHint(e.target.value)}
              rows={2}
              placeholder="Ej. nada de jeringuillas a la vista, sin logos de competidor…"
              className="w-full px-3 py-2 rounded-lg border border-rose-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>
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

        {/* Estimación de coste */}
        <div className="rounded-lg border bg-amber-50/40 border-amber-200 px-3 py-2 text-xs text-amber-900 flex items-center gap-3">
          <span className="font-medium">Coste estimado:</span>
          <span>
            Claude ~${claudeCost.toFixed(2)}
            {generateImages && <> · Imágenes ~${imageCost.toFixed(2)} ({imageQuality})</>}
          </span>
          <span className="ml-auto font-bold tabular-nums">≈ ${totalCost.toFixed(2)}</span>
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

        {error && <AiErrorBanner message={error} />}
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
  defaultClientId,
  defaultDateIso,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  post: EditorialPost | null;
  clients: UiClient[];
  defaultMonth: string;
  defaultClientId?: string;
  /** Si se abre el modal en modo "nuevo" tras hacer clic en un día del
   *  calendario, ese día llega aquí (YYYY-MM-DD) para preseleccionar la
   *  fecha en lugar del default genérico del día 15 del mes. */
  defaultDateIso?: string;
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
    aspectRatio: "auto",
    copyByNetwork: {} as Record<string, string>
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Estado del panel "Generar con IA" — sólo aplica en modo creación.
  // El usuario rellena título + ajustes y pulsa el botón; backend crea
  // la publicación + imagen en background.
  const [aiCopyLength, setAiCopyLength] = useState(50);
  const [aiPerNetworkCopy, setAiPerNetworkCopy] = useState(true);
  const [aiExtraGuidance, setAiExtraGuidance] = useState("");
  const [aiImageInclude, setAiImageInclude] = useState("");
  const [aiImageAvoid, setAiImageAvoid] = useState("");
  const [aiImageQuality, setAiImageQuality] = useState<"low" | "medium" | "high">("medium");
  const [aiForcedRoster, setAiForcedRoster] = useState<string[]>([]);
  const [aiRosterOptions, setAiRosterOptions] = useState<string[]>([]);
  const [aiRunning, setAiRunning] = useState(false);

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
        aspectRatio: post.aspectRatio ?? "auto",
        copyByNetwork: (post.copyByNetwork as Record<string, string> | null) ?? {}
      });
    } else {
      const [y, m] = defaultMonth.split("-").map(Number);
      // Si el modal se abrió tras hacer clic en un día concreto del
      // calendario, usamos ese día (a las 10:00). Si no, el 15 del mes.
      const dateForNew = defaultDateIso ?? `${defaultMonth}-15`;
      setForm({
        title: "",
        content: "",
        excerpt: "",
        scheduledFor: `${dateForNew}T10:00`,
        status: "DRAFT",
        format: "post",
        clientId: defaultClientId ?? clients[0]?.id ?? "",
        networks: ["instagram"],
        hashtags: "",
        firstComment: "",
        aspectRatio: "auto",
        copyByNetwork: {}
      });
    }
  }, [open, post, clients, defaultMonth, defaultClientId, defaultDateIso]);

  function toggleNetwork(n: string) {
    setForm((f) => ({ ...f, networks: f.networks.includes(n) ? f.networks.filter((x) => x !== n) : [...f.networks, n] }));
  }

  // Cuando estamos creando y el cliente cambia, cargamos sus
  // editorialDefaults + roster (referenceImages) para precargar el
  // panel IA. Las redes manuales sólo si están vacías.
  useEffect(() => {
    if (!open || isEdit || !form.clientId) return;
    let aborted = false;
    fetch(`/api/v1/clients/${form.clientId}/editorial-meta`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (aborted) return;
        // Roster del cliente
        const refs: any[] = Array.isArray(data?.referenceImages) ? data.referenceImages : [];
        const names = Array.from(
          new Set(
            refs
              .map((r) => (r?.personName ?? "").toString().trim())
              .filter((n: string) => n.length > 0)
          )
        );
        setAiRosterOptions(names);
        // Preset
        const p = data?.editorialDefaults;
        if (!p) return;
        if (typeof p.copyLength === "number") setAiCopyLength(Math.max(0, Math.min(100, p.copyLength)));
        if (typeof p.perNetworkCopy === "boolean") setAiPerNetworkCopy(p.perNetworkCopy);
        if (typeof p.extraGuidance === "string") setAiExtraGuidance(p.extraGuidance);
        if (typeof p.imageIncludeHint === "string") setAiImageInclude(p.imageIncludeHint);
        if (typeof p.imageAvoidHint === "string") setAiImageAvoid(p.imageAvoidHint);
        if (Array.isArray(p.forcedRoster)) setAiForcedRoster(p.forcedRoster.filter((n: any) => typeof n === "string"));
        if (p.imageQuality === "low" || p.imageQuality === "medium" || p.imageQuality === "high") {
          setAiImageQuality(p.imageQuality);
        }
        if (Array.isArray(p.networks) && p.networks.length > 0) {
          setForm((f) => (f.networks.length === 0 ? { ...f, networks: p.networks } : f));
        }
      })
      .catch(() => {});
    return () => {
      aborted = true;
    };
  }, [open, isEdit, form.clientId]);

  // Mapea el formato del form (post/carousel) al formato AI/imagen.
  function formatToAi(fmt: string): string {
    if (fmt === "post") return "imagen";
    if (fmt === "carousel") return "carrusel";
    return fmt;
  }

  async function generateWithAi() {
    if (!form.title.trim()) {
      setError("El título es obligatorio para generar con IA.");
      return;
    }
    if (!form.clientId) {
      setError("Selecciona un cliente.");
      return;
    }
    if (form.networks.length === 0) {
      setError("Selecciona al menos una red.");
      return;
    }
    setError(null);
    setAiRunning(true);
    const scheduledIso = form.scheduledFor
      ? new Date(form.scheduledFor).toISOString()
      : new Date().toISOString();
    try {
      const r = await fetch("/api/v1/editorial/generate-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: form.clientId,
          title: form.title.trim(),
          format: formatToAi(form.format),
          networks: form.networks,
          scheduledFor: scheduledIso,
          copyLength: aiCopyLength,
          perNetworkCopy: aiPerNetworkCopy,
          extraGuidance: aiExtraGuidance || undefined,
          imageIncludeHint: aiImageInclude || undefined,
          imageAvoidHint: aiImageAvoid || undefined,
          useRosterPersons: aiForcedRoster.length > 0 ? aiForcedRoster : undefined,
          status: form.status === "REVIEW" ? "REVIEW" : "DRAFT",
          imageQuality: aiImageQuality,
          // Si el usuario eligió un aspect ratio en el modal (1:1, 9:16, …),
          // se lo pasamos al generador para que respete las dimensiones tanto
          // en la imagen como en el storyboard del vídeo.
          aspectRatio:
            form.aspectRatio && form.aspectRatio !== "auto" ? form.aspectRatio : undefined
        })
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        setError(data?.error?.message ?? `Error ${r.status}`);
        setAiRunning(false);
        return;
      }
      // El toast global se ocupa del polling/notif.
      try {
        const existing = JSON.parse(localStorage.getItem("editorial.runningJobs") ?? "[]");
        const clientName = clients.find((c) => c.id === form.clientId)?.name;
        existing.push({
          id: data.jobId,
          startedAt: Date.now(),
          clientName,
          month: form.title.slice(0, 30) // mostramos topic en el toast
        });
        localStorage.setItem("editorial.runningJobs", JSON.stringify(existing));
        window.dispatchEvent(new CustomEvent("editorial:job-started", { detail: { id: data.jobId } }));
      } catch {}
      setAiRunning(false);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setAiRunning(false);
    }
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
      aspectRatio: form.aspectRatio && form.aspectRatio !== "auto" ? form.aspectRatio : null,
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
            {fullPost.client && (
              <>
                <span>·</span>
                <Link
                  href={`/clientes/${fullPost.client.id}`}
                  className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
                  title="Ver ficha del cliente"
                >
                  {fullPost.client.name}
                </Link>
              </>
            )}
          </div>

          <div className="grid md:grid-cols-[minmax(0,400px)_1fr] gap-5 items-start">
            <div>
              {images[0] ? (
                isVideoUrl(images[0]) ? (
                  <video
                    src={images[0]}
                    controls
                    playsInline
                    className="w-full max-h-[560px] object-contain rounded-xl border bg-black"
                  />
                ) : (
                  <a href={images[0]} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={images[0]}
                      alt={fullPost.title}
                      className="w-full max-h-[560px] object-contain rounded-xl border bg-slate-50 hover:opacity-95 transition"
                    />
                  </a>
                )
              ) : (
                <div className="space-y-2">
                  <div className="w-full aspect-square rounded-xl border bg-slate-50 flex items-center justify-center text-slate-400">
                    <ImageIcon className="h-10 w-10" />
                  </div>
                  {/* Si es un post de vídeo y NO tiene vídeo adjunto, ofrecemos
                      relanzar la generación directamente desde el preview, para
                      que el usuario no tenga que abrir el modal de edición. */}
                  {fullPost && ["video", "reel", "story"].includes(fullPost.format ?? "") && (
                    <RetryVideoButton
                      postId={fullPost.id}
                      onDone={() => {
                        // Refresca el detalle para que aparezca el vídeo nuevo
                        // sin cerrar el modal de preview.
                        fetch(`/api/v1/editorial/posts/${fullPost.id}`)
                          .then((r) => (r.ok ? r.json() : null))
                          .then((d) => d && setFullPost(d))
                          .catch(() => {});
                      }}
                    />
                  )}
                </div>
              )}
              {images.length > 1 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto">
                  {images.slice(1).map((u, i) => (
                    <a key={`${u}-${i}`} href={u} target="_blank" rel="noreferrer" className="shrink-0">
                      {isVideoUrl(u) ? (
                        <video
                          src={u}
                          muted
                          className="h-14 w-14 object-cover rounded-md border bg-black"
                        />
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={u} alt={`media-${i + 1}`} className="h-14 w-14 object-cover rounded-md border" />
                      )}
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
          {isEdit && post && (
            <button
              type="button"
              onClick={async () => {
                if (!confirm(`¿Eliminar la publicación "${post.title}"?\n\nEsta acción no se puede deshacer.`)) return;
                const r = await fetch(`/api/v1/editorial/posts/${post.id}`, { method: "DELETE" });
                if (r.ok) {
                  onSaved();
                  onClose();
                } else {
                  const j = await r.json().catch(() => ({}));
                  alert(j?.error?.message ?? `Error ${r.status}`);
                }
              }}
              className="px-3 py-2 rounded-lg text-sm border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 inline-flex items-center gap-1.5"
              title="Eliminar permanentemente"
            >
              <Trash2 className="h-4 w-4" />
              Eliminar
            </button>
          )}
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
          {!isEdit && (
            <button
              type="button"
              onClick={generateWithAi}
              disabled={aiRunning || !form.title.trim() || !form.clientId}
              title={
                !form.title.trim()
                  ? "Escribe un título/tema arriba para activar"
                  : "Claude genera copy + hashtags + comentario, y gpt-image-2 crea la imagen"
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {aiRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generar con IA
            </button>
          )}
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Cliente</label>
            <ClientPickerCombobox
              clients={clients}
              value={form.clientId}
              onChange={(id) => setForm({ ...form, clientId: id })}
              placeholder="— Sin cliente —"
              allowEmpty
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Estado</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Formato</label>
            <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {["post", "reel", "story", "video", "blog", "email", "carousel"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Medida / aspect ratio</label>
            <select
              value={form.aspectRatio}
              onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              title="Si lo dejas en 'auto' se usa el del cliente/formato"
            >
              <option value="auto">Auto (cliente)</option>
              <option value="1:1">1:1 · Cuadrado</option>
              <option value="2:1">2:1 · Horizontal</option>
              <option value="3:1">3:1 · Banner</option>
              <option value="2:3">2:3 · Retrato</option>
              <option value="3:2">3:2 · Estándar</option>
              <option value="3:4">3:4 · Tradicional</option>
              <option value="4:3">4:3 · Clásico</option>
              <option value="16:9">16:9 · Panorámico</option>
              <option value="9:16">9:16 · Story / Reel</option>
              <option value="21:9">21:9 · Ultrapanorámico</option>
            </select>
          </div>
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

        {/* Panel "Generar con IA" — solo en modo creación. El usuario
            rellena título + ajustes y pulsa el botón del footer. */}
        {!isEdit && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-medium text-violet-900">Generar con IA (opcional)</span>
            </div>
            <p className="text-[11px] text-slate-600">
              Rellena el título con el tema/idea y pulsa <strong>Generar con IA</strong> abajo. Claude redactará copy + hashtags + primer comentario, y gpt-image-2 creará la imagen usando las refs del cliente. Deja todo en blanco si prefieres escribir la publicación a mano y pulsar <strong>Guardar</strong>.
            </p>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Longitud del copy · <span className="text-violet-600">{aiCopyLength}%</span>{" "}
                <span className="text-slate-500">
                  ({aiCopyLength < 25
                    ? "ultra-directo (40-100 palabras)"
                    : aiCopyLength < 50
                      ? "corto (60-180 palabras)"
                      : aiCopyLength < 75
                        ? "medio (100-300 palabras)"
                        : "largo (200-450 palabras)"})
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={aiCopyLength}
                onChange={(e) => setAiCopyLength(Number(e.target.value))}
                className="w-full accent-violet-600"
              />
            </div>

            {form.networks.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aiPerNetworkCopy}
                  onChange={(e) => setAiPerNetworkCopy(e.target.checked)}
                  className="accent-violet-600"
                />
                Generar copy adaptado por cada red (más tokens, más nativo)
              </label>
            )}

            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Instrucción extra (opcional)
              </label>
              <textarea
                value={aiExtraGuidance}
                onChange={(e) => setAiExtraGuidance(e.target.value)}
                rows={2}
                placeholder="Ej. tono cercano, evita hablar de precios, incluye CTA a llamada gratuita…"
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {aiRosterOptions.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Personas del roster forzadas <span className="text-slate-500">· deben salir en la imagen</span>
                </label>
                <div className="flex flex-wrap gap-1">
                  {aiRosterOptions.map((name) => {
                    const sel = aiForcedRoster.includes(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() =>
                          setAiForcedRoster((prev) =>
                            prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
                          )
                        }
                        className={
                          "px-2 py-1 rounded-md text-[11px] transition border " +
                          (sel
                            ? "bg-violet-50 border-violet-300 text-violet-700 font-medium"
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                        }
                      >
                        {sel ? "✓ " : ""}{name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  Si no marcas nadie, Claude detecta a quién meter por mención en el copy (incluye "equipo" → todo el roster).
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-emerald-800 mb-1">
                  Qué SÍ debe aparecer en la imagen (opcional)
                </label>
                <textarea
                  value={aiImageInclude}
                  onChange={(e) => setAiImageInclude(e.target.value)}
                  rows={3}
                  placeholder="Ej. Rochar examinando a una paciente, ambiente luminoso, plantas verdes…"
                  className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-rose-800 mb-1">
                  Qué NO debe aparecer (negativo, opcional)
                </label>
                <textarea
                  value={aiImageAvoid}
                  onChange={(e) => setAiImageAvoid(e.target.value)}
                  rows={3}
                  placeholder="Ej. nada de jeringuillas, ningún logo de competidor, sin texto sobre la piel…"
                  className="w-full px-3 py-2 rounded-lg border border-rose-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[11px] font-medium text-slate-700">Calidad imagen:</label>
              <div className="flex gap-1">
                {(["low", "medium", "high"] as const).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAiImageQuality(q)}
                    className={
                      "px-2 py-1 rounded-md text-[11px] border " +
                      (aiImageQuality === q
                        ? "bg-violet-100 border-violet-300 text-violet-800 font-medium"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                    }
                  >
                    {q === "low" ? "Baja (~$0.02)" : q === "medium" ? "Media (~$0.04)" : "Alta (~$0.17)"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

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
          <GenerateImageBar
            postId={post.id}
            clientId={form.clientId || ((post as any)?.clientId ?? "")}
            initialPattern={(post as any).visualPattern ?? null}
            initialStrength={(post as any).patternStrength ?? null}
            initialTemplateId={(post as any).patternTemplateId ?? null}
            onGenerated={() => onSaved()}
          />
        )}

        {/* Modificar la imagen actual con un prompt (img2img) */}
        {isEdit && post && fullPost?.thumbnail && (
          <EditImageBar
            postId={post.id}
            thumbnail={fullPost.thumbnail}
            onEdited={() => onSaved()}
          />
        )}

        {/* Generar vídeo con IA (reel/story/video) */}
        {isEdit && post && (
          <GenerateVideoBar postId={post.id} onGenerated={() => onSaved()} />
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

        {/* Adaptar formato (regenerar imagen en otro aspect ratio) */}
        {isEdit && post && (
          <AdaptFormatBar
            postId={post.id}
            currentFormat={form.format}
            onAdapted={() => onSaved()}
          />
        )}

        {/* Hilo con el cliente — mensajes intercambiados desde el panel
            público de aprobación. Solo se muestra si la pieza ya está
            persistida (post.id existe). */}
        {isEdit && post && <AdminPostThread postId={post.id} />}

        {/* Historial de revisiones (incluye acciones IA aplicadas) */}
        {isEdit && fullPost?.revisions && fullPost.revisions.length > 0 && (
          <details className="rounded-lg border bg-slate-50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700 select-none">
              📚 Historial de cambios ({fullPost.revisions.length})
            </summary>
            <div className="px-3 py-2 border-t bg-white max-h-64 overflow-y-auto">
              <ol className="space-y-2 text-xs">
                {fullPost.revisions.map((r) => (
                  <li key={r.id} className="border-l-2 border-slate-200 pl-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-slate-700">
                        {r.changeSummary ?? "(sin descripción)"}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(r.createdAt).toLocaleString("es-ES")}
                      </span>
                    </div>
                    {r.body && (
                      <pre className="mt-0.5 whitespace-pre-wrap font-sans text-slate-600 text-[11px] line-clamp-3">
                        {r.body.length > 240 ? r.body.slice(0, 240) + "…" : r.body}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </details>
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
  const hasVideo = urls.some(isVideoUrl);
  return (
    <div>
      <div className="text-xs font-medium text-slate-700 mb-1.5">
        {hasVideo ? "Media" : "Imágenes"} ({urls.length})
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {urls.map((u, i) =>
          isVideoUrl(u) ? (
            <video
              key={`${u}-${i}`}
              src={u}
              controls
              playsInline
              className="h-24 w-40 object-cover rounded-lg border bg-black shrink-0"
            />
          ) : (
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
          )
        )}
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

function AdaptFormatBar({
  postId,
  currentFormat,
  onAdapted
}: {
  postId: string;
  currentFormat: string;
  onAdapted: () => void;
}) {
  const [target, setTarget] = useState<"imagen" | "reel" | "carrusel" | "story" | "video">("reel");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [changePostFormat, setChangePostFormat] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    setDone(false);
    const r = await fetch(`/api/v1/editorial/posts/${postId}/adapt-format`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: target, quality, changePostFormat })
    });
    setRunning(false);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setDone(true);
    onAdapted();
  }

  return (
    <div className="rounded-lg border bg-fuchsia-50/40 border-fuchsia-200 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-fuchsia-600" />
        <span className="text-xs font-semibold text-fuchsia-900">Adaptar a otro formato</span>
      </div>
      <p className="text-[11px] text-slate-600">
        Regenera la imagen con el mismo prompt pero en el aspect ratio del formato elegido (lee
        dimensionesByFormat del cliente). Útil para tener feed 4:5 + Reel 9:16 de la misma idea.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as any)}
          className="px-2 py-1 rounded-md border bg-white text-xs"
        >
          {["imagen", "reel", "carrusel", "story", "video"].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(["low", "medium", "high"] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuality(q)}
              className={
                "px-2 py-1 rounded-md text-[11px] border " +
                (quality === q
                  ? "bg-fuchsia-100 border-fuchsia-300 text-fuchsia-800 font-medium"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
              }
            >
              {q}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[11px] cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={changePostFormat}
            onChange={(e) => setChangePostFormat(e.target.checked)}
            className="accent-fuchsia-600"
          />
          También cambiar formato del post
        </label>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Adaptar a {target}
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {done && <p className="text-[11px] text-emerald-700">✓ Imagen adaptada al formato {target}.</p>}
    </div>
  );
}

function CompetitorsModal({
  open,
  onClose,
  clientId
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ topics: any[]; competitorsList: string[] } | null>(null);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
    }
  }, [open]);

  async function run() {
    if (!clientId) return;
    setRunning(true);
    setError(null);
    const r = await fetch(`/api/v1/clients/${clientId}/analyze-competitors`, { method: "POST" });
    setRunning(false);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setData(j);
  }

  return (
    <Modal open={open} onClose={onClose} title="🔍 Análisis de competencia con IA" size="lg">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Claude leerá los competidores configurados en la ficha de este cliente y devolverá temas trending del nicho
          con sugerencias concretas de publicaciones. Si el campo competidores está vacío, los infiere por sector.
        </p>
        {!data && (
          <div className="text-center py-6">
            <button
              type="button"
              onClick={run}
              disabled={running}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {running && <Loader2 className="h-4 w-4 animate-spin" />}
              Analizar
            </button>
          </div>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {data && (
          <>
            {data.competitorsList.length > 0 && (
              <div className="text-[11px] text-slate-500">
                Analizados: {data.competitorsList.join(" · ")}
              </div>
            )}
            <div className="space-y-2 max-h-[460px] overflow-y-auto">
              {data.topics.map((t, i) => (
                <div key={i} className="rounded-lg border bg-violet-50/40 border-violet-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm text-violet-900">{t.topic}</div>
                    <div className="flex gap-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
                        {t.tone}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {t.suggestedFormat}
                      </span>
                    </div>
                  </div>
                  {t.suggestions?.length > 0 && (
                    <ul className="mt-1.5 list-disc pl-5 text-xs text-slate-700 space-y-0.5">
                      {t.suggestions.map((s: string, j: number) => (
                        <li key={j}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={run}
              disabled={running}
              className="text-xs text-violet-600 hover:underline disabled:opacity-50"
            >
              Re-analizar
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function EditorialSettingsModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [imageModel, setImageModel] = useState("openai-gpt-image-1");
  const [freepikConfigured, setFreepikConfigured] = useState(false);
  const [freepikKey, setFreepikKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setFreepikKey("");
    fetch("/api/v1/editorial/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setWebhookUrl(d.makeWebhookUrl ?? "");
          setImageModel(d.imageModel ?? "openai-gpt-image-1");
          setFreepikConfigured(!!d.freepikConfigured);
        }
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function save() {
    setSaving(true);
    setError(null);
    const body: any = {
      makeWebhookUrl: webhookUrl || null,
      imageModel
    };
    if (freepikKey) body.freepikApiKey = freepikKey;
    const r = await fetch("/api/v1/editorial/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setFreepikKey("");
    setFreepikConfigured((v) => v || !!body.freepikApiKey);
    setSavedAt(new Date());
  }

  async function clearFreepik() {
    if (!confirm("¿Borrar la API key de Freepik?")) return;
    await fetch("/api/v1/editorial/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ freepikApiKey: null })
    });
    setFreepikConfigured(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="⚙️ Configuración editorial"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cerrar</button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Webhook Make / Zapier</label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hook.eu1.make.com/..."
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Al aprobar un mes se envía POST con{" "}
            <code className="text-[10px]">{`{event, cliente, mes, aprobadas, timestamp}`}</code>.
          </p>
        </div>

        <div className="border-t pt-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">Modelo de imagen por defecto</label>
          <select
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="openai-gpt-image-1">OpenAI gpt-image-1 (calidad, ~$0.04-0.17)</option>
            <option value="freepik-seedream-v4">Freepik Seedream v4 (barato, ~$0.002)</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Cada cliente puede sobrescribirlo en su ficha editorial.
          </p>
        </div>

        <div className="border-t pt-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            API key Freepik {freepikConfigured && <span className="text-[10px] text-emerald-600">· configurada ✓</span>}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={freepikKey}
              onChange={(e) => setFreepikKey(e.target.value)}
              placeholder={freepikConfigured ? "•••••••• (deja vacío para no cambiar)" : "FREEPIK-XXXX-…"}
              className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {freepikConfigured && (
              <button
                type="button"
                onClick={clearFreepik}
                className="px-2 py-1.5 rounded-md border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 text-xs"
              >
                Borrar
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Necesaria si usas Freepik. Se guarda cifrada con AES-256-GCM.
          </p>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
        {savedAt && (
          <p className="text-xs text-emerald-700">Guardado a las {savedAt.toLocaleTimeString("es-ES")}.</p>
        )}
      </div>
    </Modal>
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

type PatternTemplateUi = { id: string; url: string; name: string; notes?: string };

function GenerateImageBar({
  postId,
  clientId,
  initialPattern,
  initialStrength,
  initialTemplateId,
  onGenerated
}: {
  postId: string;
  clientId?: string;
  initialPattern?: string | null;
  initialStrength?: number | null;
  initialTemplateId?: string | null;
  onGenerated: () => void;
}) {
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  // Selección unificada: "" = por defecto del cliente, "preset:<key>" =
  // patrón predefinido, "tpl:<id>" = plantilla subida del cliente.
  const [selection, setSelection] = useState<string>(
    initialTemplateId ? `tpl:${initialTemplateId}` : initialPattern ? `preset:${initialPattern}` : ""
  );
  const [strength, setStrength] = useState<number>(
    typeof initialStrength === "number" ? initialStrength : 50
  );
  const [templates, setTemplates] = useState<PatternTemplateUi[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  // Cargar las plantillas visuales del cliente para el selector.
  useEffect(() => {
    if (!clientId) {
      setTemplates([]);
      return;
    }
    let alive = true;
    fetch(`/api/v1/clients/${clientId}/editorial-meta`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const list = Array.isArray(d?.patternTemplates) ? (d.patternTemplates as PatternTemplateUi[]) : [];
        setTemplates(list);
      })
      .catch(() => alive && setTemplates([]));
    return () => {
      alive = false;
    };
  }, [clientId]);

  const presetKey = selection.startsWith("preset:") ? selection.slice(7) : "";
  const templateId = selection.startsWith("tpl:") ? selection.slice(4) : "";
  const selectedPattern = VISUAL_PATTERNS.find((p) => p.key === presetKey);
  const selectedTemplate = templates.find((t) => t.id === templateId);

  async function run() {
    setRunning(true);
    setError(null);
    const r = await fetch(`/api/v1/editorial/posts/${postId}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quality,
        // Mandamos override explícito de patrón/plantilla. null limpia.
        visualPattern: presetKey || null,
        patternTemplateId: templateId || null,
        patternStrength: strength
      })
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

      {/* Patrón / plantilla visual + intensidad */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-slate-700">Patrón / plantilla visual</label>
        <select
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          className="w-full px-2 py-1.5 rounded-md border border-slate-200 bg-white text-[12px] focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <option value="">Por defecto del cliente</option>
          {templates.length > 0 && (
            <optgroup label="Plantillas del cliente">
              {templates.map((t) => (
                <option key={t.id} value={`tpl:${t.id}`}>
                  🎨 {t.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Estilos predefinidos">
            {VISUAL_PATTERNS.map((p) => (
              <option key={p.key} value={`preset:${p.key}`}>
                {p.label}
              </option>
            ))}
          </optgroup>
        </select>
        {selectedTemplate && (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedTemplate.url}
              alt={selectedTemplate.name}
              className="h-12 w-12 rounded object-cover border bg-white"
            />
            <p className="text-[10.5px] text-slate-500 leading-snug">
              La IA usará esta plantilla como guía de estilo/layout.
              {selectedTemplate.notes ? ` ${selectedTemplate.notes}` : ""}
            </p>
          </div>
        )}
        {selectedPattern && (
          <p className="text-[10.5px] text-slate-500 leading-snug">{selectedPattern.description}</p>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[11px] text-slate-600 whitespace-nowrap">Intensidad</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            className="flex-1 accent-sky-600"
          />
          <span className="text-[11px] font-semibold text-sky-800 tabular-nums w-9 text-right">{strength}%</span>
        </div>
        <p className="text-[10px] text-slate-400 leading-snug">
          0% = foto editorial neutra · 50% = aplica el estilo · 100% = lo replica con fuerza.
        </p>
      </div>

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

/** Botón compacto para relanzar la generación de vídeo desde el preview de
 *  un post de vídeo que se quedó sin media (porque la primera ejecución
 *  falló). Muestra el error inline para que el usuario sepa qué pasó.
 */
function RetryVideoButton({ postId, onDone }: { postId: string; onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setDone(null);
    try {
      const r = await fetch(`/api/v1/editorial/posts/${postId}/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shots: 2, voiceover: true, subtitles: true })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setDone(j?.note ?? "Vídeo generado y adjuntado.");
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Error de red");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-60"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
        {running ? "Generando vídeo (1-5 min)…" : "Generar vídeo ahora"}
      </button>
      {error && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 whitespace-pre-wrap">
          {error}
        </div>
      )}
      {done && (
        <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          {done}
        </div>
      )}
    </div>
  );
}

/** Barra "Modificar imagen con IA": el usuario escribe qué cambiar de la
 *  imagen ACTUAL del post (img2img). Conserva composición, marca y texto,
 *  y aplica solo la modificación pedida. Solo visible si hay thumbnail. */
function EditImageBar({
  postId,
  thumbnail,
  onEdited
}: {
  postId: string;
  thumbnail: string;
  onEdited: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    if (!prompt.trim()) return;
    setRunning(true);
    setError(null);
    setDone(false);
    const r = await fetch(`/api/v1/editorial/posts/${postId}/edit-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.trim(), quality })
    });
    setRunning(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setDone(true);
    setPrompt("");
    onEdited();
  }

  return (
    <div className="rounded-lg border bg-violet-50/40 border-violet-200 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Pencil className="h-4 w-4 text-violet-600" />
        <span className="text-xs font-semibold text-violet-900">Modificar imagen con IA</span>
      </div>
      <div className="flex gap-2 items-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnail} alt="Imagen actual" className="h-14 w-14 rounded object-cover border bg-white shrink-0" />
        <p className="text-[11px] text-slate-600">
          Escribe qué quieres cambiar de la imagen actual y la IA aplicará <strong>solo ese cambio</strong>,
          conservando composición, colores, texto y logo. La versión anterior queda guardada en el historial de medios.
        </p>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        placeholder='p. ej. "Quita el portátil de la mesa", "Haz el cielo de atardecer", "Que la persona sonría mirando a cámara"'
        className="w-full px-2 py-1.5 rounded-md border border-slate-200 bg-white text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y"
      />
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
                  ? "bg-violet-100 border-violet-300 text-violet-800 font-medium"
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
          disabled={running || !prompt.trim()}
          title={!prompt.trim() ? "Escribe primero qué quieres cambiar" : "Modificar la imagen actual"}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {running ? "Modificando…" : "Modificar imagen"}
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {done && <p className="text-[11px] text-emerald-700">✓ Imagen modificada y asociada al post.</p>}
    </div>
  );
}

function GenerateVideoBar({ postId, onGenerated }: { postId: string; onGenerated: () => void }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [shots, setShots] = useState(2);
  const [voiceover, setVoiceover] = useState(true);
  const [subtitles, setSubtitles] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setDone(null);
    try {
      const r = await fetch(`/api/v1/editorial/posts/${postId}/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extraGuidance: extra.trim() || undefined, shots, voiceover, subtitles })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setDone(j?.note ?? "Vídeo generado y adjuntado al post.");
      onGenerated();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-lg border bg-violet-50/40 border-violet-200 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Film className="h-4 w-4 text-violet-600" />
        <span className="text-xs font-semibold text-violet-900">Generar vídeo con IA (imágenes + Freepik/Kling)</span>
      </div>
      <p className="text-[11px] text-slate-600">
        Genera una imagen por toma con gpt-image-2 (mismo look que las imágenes) y la anima con Freepik/Kling 2.0.
        Monta las tomas en un solo reel y, si lo marcas, añade voz en off (ElevenLabs) y subtítulos sincronizados.
        9:16 para reel/story, 16:9 para vídeo. Tarda varios minutos por toma. Requiere la API key de Freepik
        (Administración → Calendario editorial), OpenAI y, para la voz, ElevenLabs.
      </p>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-slate-600">Tomas</label>
        <select
          value={shots}
          onChange={(e) => setShots(Number(e.target.value))}
          className="px-2 py-1.5 rounded-md border border-slate-200 text-[11px] bg-white"
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-slate-400">una imagen + clip por toma</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
          <input type="checkbox" checked={voiceover} onChange={(e) => setVoiceover(e.target.checked)} className="accent-violet-600" />
          Voz en off (ElevenLabs)
        </label>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
          <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} className="accent-violet-600" />
          Subtítulos
        </label>
      </div>
      <input
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        placeholder="Dirección extra (opcional): 'plano cenital del producto girando', 'persona usando la app'…"
        className="w-full px-2 py-1.5 rounded-md border border-slate-200 text-[11px]"
      />
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
      >
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {running ? "Generando vídeo… (varios min)" : "Generar vídeo"}
      </button>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {done && <div className="text-[11px] text-emerald-700">✓ {done}</div>}
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

/**
 * Muestra un mensaje de error IA con estilo según el contenido.
 * Si el mensaje sugiere falta de saldo, añade un link directo a billing.
 */
/**
 * Zona de papelera al pie del calendario. Recibe drops de publicaciones
 * (mismo dataTransfer que el drag&drop de reprogramar) y las borra.
 *
 * Highlight rojo + escala al pasar por encima; confirm() antes de borrar.
 */
function CalendarTrashZone({ onDropped }: { onDropped: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className={
        "mt-2 mx-1 mb-1 rounded-lg border-2 border-dashed transition-all flex items-center justify-center gap-2 text-sm select-none " +
        (hover
          ? "border-rose-400 bg-rose-50 text-rose-700 py-6 scale-[1.01]"
          : "border-slate-200 bg-slate-50/50 text-slate-400 py-3")
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/post-id")) {
          e.preventDefault();
          setHover(true);
        }
      }}
      onDragLeave={() => setHover(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setHover(false);
        const postId = e.dataTransfer.getData("text/post-id");
        if (!postId) return;
        if (!confirm("¿Eliminar esta publicación?\n\nEsta acción no se puede deshacer.")) return;
        const r = await fetch(`/api/v1/editorial/posts/${postId}`, { method: "DELETE" });
        if (r.ok) {
          onDropped();
        } else {
          const j = await r.json().catch(() => ({}));
          alert(j?.error?.message ?? `Error ${r.status}`);
        }
      }}
    >
      <Trash2 className={"h-4 w-4 " + (hover ? "animate-bounce" : "")} />
      <span className="font-medium">
        {hover ? "Suelta aquí para eliminar" : "Arrastra una publicación aquí para eliminarla"}
      </span>
    </div>
  );
}

function AiErrorBanner({ message }: { message: string }) {
  const noCredits =
    /credit balance|too low|billing|saldo/i.test(message);
  const badKey = /api key|authentication|invalid/i.test(message);
  if (noCredits) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs space-y-1.5">
        <div className="font-semibold text-amber-900">💳 Saldo de Anthropic agotado</div>
        <p className="text-amber-900">{message}</p>
        <a
          href="https://console.anthropic.com/settings/billing"
          target="_blank"
          rel="noreferrer"
          className="inline-block px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-medium"
        >
          Cargar saldo en console.anthropic.com →
        </a>
      </div>
    );
  }
  if (badKey) {
    return (
      <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs space-y-1.5">
        <div className="font-semibold text-rose-900">🔑 API key inválida</div>
        <p className="text-rose-900">{message}</p>
        <a
          href="/admin/ai"
          className="inline-block px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-medium"
        >
          Reconfigurar API key →
        </a>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-2.5 text-xs text-rose-700">
      {message}
    </div>
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
  defaultClientId,
  onDone
}: {
  open: boolean;
  onClose: () => void;
  clients: UiClient[];
  month: string;
  defaultClientId?: string;
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
    setClientIds(defaultClientId ? [defaultClientId] : []);
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
                    <div className="mt-1.5">
                      <a
                        href={`/p/cliente/${l.token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-brand-700 hover:underline"
                      >
                        Vista de portal del cliente (proyectos + eventos) ↗
                      </a>
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

// Combobox de filtro de cliente con buscador. Lista alfabética + opción
// "Todos" siempre arriba. Se cierra al click fuera o al elegir un cliente.
// Selector de UN cliente con buscador server-side. Para los modales
// (Generar mes con IA, Nueva publicación…) donde el <select> nativo no
// podía mostrar clientes fuera de los 500 precargados ni permitía buscar.
function ClientPickerCombobox({
  clients,
  value,
  onChange,
  placeholder = "Selecciona cliente…",
  allowEmpty = false
}: {
  clients: UiClient[];
  value: string;
  onChange: (id: string, name?: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<UiClient[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
    [clients]
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setRemote(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/v1/clients?limit=50&q=${encodeURIComponent(q)}`);
        if (r.ok) setRemote((await r.json()).items ?? []);
      } catch {
        /* red: filtro local */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    const base = remote ?? sorted.filter((c) => c.name.toLowerCase().includes(q));
    return [...base].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [sorted, query, remote]);

  const selectedName = !value ? "" : clients.find((c) => c.id === value)?.name ?? pickedName ?? "";

  // Resuelve el nombre del cliente preseleccionado aunque no esté en la
  // lista precargada (quedó fuera del tope de 500).
  useEffect(() => {
    if (!value) {
      setPickedName(null);
      return;
    }
    if (clients.find((c) => c.id === value)) return;
    let cancelled = false;
    fetch(`/api/v1/clients/${value}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!cancelled && c?.name) setPickedName(c.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value, clients]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(id: string, name?: string) {
    onChange(id, name);
    setPickedName(id ? name ?? null : null);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-white text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <span className={"truncate " + (selectedName ? "" : "text-slate-400")}>{selectedName || placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-full min-w-[16rem] rounded-lg border bg-white shadow-lg p-2">
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente…"
              className="w-full pl-7 pr-7 py-1.5 rounded-md border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <ul className="max-h-72 overflow-y-auto -mx-1">
            {allowEmpty && (
              <li>
                <button
                  type="button"
                  onClick={() => pick("")}
                  className={
                    "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-slate-100 " +
                    (value === "" ? "bg-brand-50 text-brand-700 font-medium" : "")
                  }
                >
                  — Sin cliente —
                </button>
              </li>
            )}
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c.id, c.name)}
                  className={
                    "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-slate-100 truncate " +
                    (value === c.id ? "bg-brand-50 text-brand-700 font-medium" : "")
                  }
                >
                  {c.name}
                </button>
              </li>
            ))}
            {loading && <li className="px-2 py-3 text-xs text-slate-400 text-center">Buscando…</li>}
            {!loading && filtered.length === 0 && (
              <li className="px-2 py-3 text-xs text-slate-400 text-center">Sin resultados</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ClientFilterCombobox({
  clients,
  value,
  onChange
}: {
  clients: UiClient[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<UiClient[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
    [clients]
  );
  // Búsqueda en servidor con debounce. La lista precargada está topada
  // a 500 clientes (los más recientes), así que en workspaces con más
  // clientes hay que consultar la BD para encontrar al resto.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setRemote(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/v1/clients?limit=50&q=${encodeURIComponent(q)}`);
        if (r.ok) setRemote((await r.json()).items ?? []);
      } catch {
        /* red: nos quedamos con el filtro local */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    const base = remote ?? sorted.filter((c) => c.name.toLowerCase().includes(q));
    return [...base].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [sorted, query, remote]);

  // Nombre a mostrar en el pill. Si el cliente seleccionado no está en
  // la lista precargada (porque quedó fuera del tope de 500), lo
  // resolvemos: del último pick o consultándolo por id.
  const selectedName =
    value === "ALL" ? "Todos" : clients.find((c) => c.id === value)?.name ?? pickedName ?? "…";

  useEffect(() => {
    if (value === "ALL") {
      setPickedName(null);
      return;
    }
    if (clients.find((c) => c.id === value)) return;
    let cancelled = false;
    fetch(`/api/v1/clients/${value}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!cancelled && c?.name) setPickedName(c.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value, clients]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    // Foco en el input de búsqueda al abrir
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(id: string, name?: string) {
    onChange(id);
    setPickedName(id === "ALL" ? null : name ?? null);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs hover:bg-slate-50"
      >
        <Filter className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-slate-500">Cliente:</span>
        <span className="font-medium max-w-[180px] truncate">{selectedName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 w-72 rounded-lg border bg-white shadow-lg p-2">
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente…"
              className="w-full pl-7 pr-7 py-1.5 rounded-md border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <ul className="max-h-72 overflow-y-auto -mx-1">
            <li>
              <button
                type="button"
                onClick={() => pick("ALL")}
                className={
                  "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-slate-100 " +
                  (value === "ALL" ? "bg-brand-50 text-brand-700 font-medium" : "")
                }
              >
                Todos
              </button>
            </li>
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c.id, c.name)}
                  className={
                    "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-slate-100 truncate " +
                    (value === c.id ? "bg-brand-50 text-brand-700 font-medium" : "")
                  }
                >
                  {c.name}
                </button>
              </li>
            ))}
            {loading && (
              <li className="px-2 py-3 text-xs text-slate-400 text-center">Buscando…</li>
            )}
            {!loading && filtered.length === 0 && (
              <li className="px-2 py-3 text-xs text-slate-400 text-center">Sin resultados</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
