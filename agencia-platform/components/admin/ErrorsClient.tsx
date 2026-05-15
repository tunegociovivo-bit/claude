"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, AlertOctagon, ExternalLink, CheckCircle2, X, RefreshCw } from "lucide-react";

type ErrorReport = {
  id: string;
  source: string;
  status: string;
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
  context: any;
  fingerprint: string | null;
  count: number;
  githubIssueUrl: string | null;
  resolutionNote: string | null;
  resolutionCommit: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_OPTIONS = [
  { value: "REPORTED", label: "Reportado", color: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  { value: "ACKNOWLEDGED", label: "Visto", color: "bg-sky-100 text-sky-800 border-sky-200", dot: "bg-sky-500" },
  { value: "IN_PROGRESS", label: "Arreglando", color: "bg-violet-100 text-violet-800 border-violet-200", dot: "bg-violet-500" },
  { value: "RESOLVED", label: "Resuelto", color: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  { value: "DISMISSED", label: "Descartado", color: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" }
];

const SOURCE_LABELS: Record<string, string> = {
  client: "🖥️ Cliente",
  server: "⚙️ Servidor",
  api: "🔌 API"
};

export default function ErrorsClient() {
  const [items, setItems] = useState<ErrorReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selected, setSelected] = useState<ErrorReport | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/v1/admin/error-reports${statusFilter !== "ALL" ? `?status=${statusFilter}` : ""}`);
    if (r.ok) setItems((await r.json()).items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // refresca cada 15s
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { REPORTED: 0, ACKNOWLEDGED: 0, IN_PROGRESS: 0, RESOLVED: 0, DISMISSED: 0 };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);

  async function update(id: string, data: any) {
    const r = await fetch(`/api/v1/admin/error-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (r.ok) load();
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar este error report permanentemente?")) return;
    await fetch(`/api/v1/admin/error-reports/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Errores de la plataforma"
        description="Reportes automáticos capturados en cliente, servidor y API. Se agrupan por huella; los abiertos se muestran arriba."
        actions={
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Refrescar
          </button>
        }
      />

      {/* Contadores por estado */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(statusFilter === s.value ? "ALL" : s.value)}
            className={
              "rounded-lg border bg-white p-3 text-left transition " +
              (statusFilter === s.value ? "ring-2 ring-brand-500" : "hover:border-slate-300")
            }
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`h-2 w-2 rounded-full ${s.dot}`} />
              <span className="text-[11px] uppercase tracking-wide text-slate-500">{s.label}</span>
            </div>
            <div className="text-2xl font-semibold">{counts[s.value] ?? 0}</div>
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading && items.length === 0 ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <ErrorRow key={it.id} item={it} onOpen={() => setSelected(it)} onUpdate={update} />
          ))}
        </div>
      )}

      {selected && (
        <DetailModal item={selected} onClose={() => setSelected(null)} onUpdate={update} onDelete={remove} />
      )}
    </div>
  );
}

function ErrorRow({
  item,
  onOpen,
  onUpdate
}: {
  item: ErrorReport;
  onOpen: () => void;
  onUpdate: (id: string, data: any) => void;
}) {
  const st = STATUS_OPTIONS.find((s) => s.value === item.status) ?? STATUS_OPTIONS[0];
  const isOpen = ["REPORTED", "ACKNOWLEDGED", "IN_PROGRESS"].includes(item.status);
  const minutesOpen = Math.max(1, Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 60000));
  return (
    <div className={`bg-white rounded-lg border ${isOpen ? "border-amber-200" : ""} hover:shadow-sm transition`}>
      <div className="flex items-start gap-3 p-3">
        <span className={`mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${st.color}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          {st.label}
        </span>
        <div className="flex-1 min-w-0">
          <button
            onClick={onOpen}
            className="text-sm font-medium text-slate-900 hover:text-brand-700 text-left block w-full truncate"
          >
            {item.message}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span>{SOURCE_LABELS[item.source] ?? item.source}</span>
            {item.count > 1 && <span>· repetido {item.count}×</span>}
            <span>· abierto {minutesOpen}min</span>
            {item.url && <span className="truncate max-w-xs">· {new URL(item.url).pathname}</span>}
            {item.githubIssueUrl && (
              <a href={item.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-600 hover:underline">
                <ExternalLink className="h-3 w-3" />
                Issue
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {item.status === "REPORTED" && (
            <button
              onClick={() => onUpdate(item.id, { status: "ACKNOWLEDGED" })}
              className="text-[10px] px-2 py-1 rounded border bg-white hover:bg-sky-50 border-sky-200 text-sky-700"
            >
              Marcar visto
            </button>
          )}
          {(item.status === "REPORTED" || item.status === "ACKNOWLEDGED") && (
            <button
              onClick={() => onUpdate(item.id, { status: "IN_PROGRESS" })}
              className="text-[10px] px-2 py-1 rounded border bg-white hover:bg-violet-50 border-violet-200 text-violet-700"
            >
              Arreglando
            </button>
          )}
          {isOpen && (
            <button
              onClick={() => onUpdate(item.id, { status: "RESOLVED" })}
              className="text-[10px] px-2 py-1 rounded border bg-white hover:bg-emerald-50 border-emerald-200 text-emerald-700"
            >
              Resuelto
            </button>
          )}
        </div>
      </div>
      {/* Barra de progreso animada cuando está abierto */}
      {isOpen && (
        <div className="h-1 bg-amber-100">
          <div
            className="h-full bg-amber-500"
            style={{ width: `${Math.min(95, (minutesOpen / 30) * 100)}%`, transition: "width 1s linear" }}
          />
        </div>
      )}
    </div>
  );
}

function DetailModal({
  item,
  onClose,
  onUpdate,
  onDelete
}: {
  item: ErrorReport;
  onClose: () => void;
  onUpdate: (id: string, data: any) => void;
  onDelete: (id: string) => void;
}) {
  const [resolutionNote, setResolutionNote] = useState(item.resolutionNote ?? "");
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-4 py-3 border-b">
          <div>
            <h2 className="font-semibold text-base">{item.message}</h2>
            <div className="text-[11px] text-slate-500 mt-0.5">
              <code>#{item.id.slice(0, 12)}</code> · fingerprint <code>{item.fingerprint?.slice(0, 12)}</code>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {item.stack && (
            <details className="rounded border bg-slate-50">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Stack trace</summary>
              <pre className="px-3 py-2 text-[10px] whitespace-pre-wrap font-mono text-slate-700 border-t bg-white max-h-64 overflow-y-auto">
                {item.stack}
              </pre>
            </details>
          )}
          {item.context && (
            <details className="rounded border bg-slate-50">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Contexto</summary>
              <pre className="px-3 py-2 text-[10px] whitespace-pre-wrap font-mono text-slate-700 border-t bg-white max-h-64 overflow-y-auto">
                {JSON.stringify(item.context, null, 2)}
              </pre>
            </details>
          )}
          <dl className="text-xs grid grid-cols-2 gap-2">
            <dt className="text-slate-500">Fuente:</dt>
            <dd>{SOURCE_LABELS[item.source] ?? item.source}</dd>
            <dt className="text-slate-500">URL:</dt>
            <dd className="truncate">{item.url ?? "—"}</dd>
            <dt className="text-slate-500">User-Agent:</dt>
            <dd className="truncate">{item.userAgent ?? "—"}</dd>
            <dt className="text-slate-500">Repetido:</dt>
            <dd>{item.count} veces</dd>
            <dt className="text-slate-500">Reportado:</dt>
            <dd>{new Date(item.createdAt).toLocaleString("es-ES")}</dd>
            {item.acknowledgedAt && (
              <>
                <dt className="text-slate-500">Visto:</dt>
                <dd>{new Date(item.acknowledgedAt).toLocaleString("es-ES")}</dd>
              </>
            )}
            {item.resolvedAt && (
              <>
                <dt className="text-slate-500">Resuelto:</dt>
                <dd>{new Date(item.resolvedAt).toLocaleString("es-ES")}</dd>
              </>
            )}
            {item.resolutionCommit && (
              <>
                <dt className="text-slate-500">Commit:</dt>
                <dd className="font-mono text-[10px]">{item.resolutionCommit}</dd>
              </>
            )}
          </dl>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nota de resolución</label>
            <textarea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
              placeholder="¿Qué se cambió para arreglarlo?"
            />
          </div>
          <a
            href="https://claude.ai/code/session_01CA9ihZJxnRBKpd64rc1mg9"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Abrir sesión de soporte (Claude Code)
          </a>
        </div>
        <div className="border-t px-4 py-3 flex flex-wrap gap-2 justify-between">
          <button
            onClick={() => onDelete(item.id)}
            className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-rose-50 border-rose-200 text-rose-700"
          >
            Borrar
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onUpdate(item.id, { status: "DISMISSED", resolutionNote })}
              className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-slate-50"
            >
              Descartar
            </button>
            <button
              onClick={() => onUpdate(item.id, { status: "RESOLVED", resolutionNote })}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Marcar resuelto
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return <div className="flex items-center justify-center py-12 text-slate-500"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…</div>;
}
function Empty() {
  return (
    <div className="bg-white rounded-xl border p-10 text-center">
      <AlertOctagon className="h-8 w-8 text-slate-300 mx-auto mb-2" />
      <p className="text-sm font-medium text-slate-700">Sin errores</p>
      <p className="text-xs text-slate-500 mt-1">Cuando la plataforma capture un error, aparecerá aquí.</p>
    </div>
  );
}
