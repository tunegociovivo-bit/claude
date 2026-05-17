"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Mail,
  MessageSquare,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  AlertCircle,
  Send,
  Calendar
} from "lucide-react";

type Kind = "EMAIL" | "WHATSAPP" | "EDITORIAL_POST" | "CALENDAR_EVENT" | "CUSTOM";
type Status = "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED";

type Draft = {
  id: string;
  kind: Kind;
  title: string;
  payload: any;
  status: Status;
  reviewedAt: string | null;
  reviewerNote: string | null;
  executedAt: string | null;
  executionResult: any | null;
  createdAt: string;
  taskId: string | null;
  aiAgentRunId: string | null;
};

const KIND_LABEL: Record<Kind, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  EDITORIAL_POST: "Post editorial",
  CALENDAR_EVENT: "Evento calendario",
  CUSTOM: "Acción libre"
};

const KIND_ICON: Record<Kind, React.ElementType> = {
  EMAIL: Mail,
  WHATSAPP: MessageSquare,
  EDITORIAL_POST: FileText,
  CALENDAR_EVENT: Calendar,
  CUSTOM: AlertCircle
};

const STATUS_STYLE: Record<Status, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-sky-100 text-sky-700",
  REJECTED: "bg-slate-200 text-slate-600",
  EXECUTED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-rose-100 text-rose-700"
};

export default function NvIaDraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | "ALL">("PENDING");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const url = filter === "ALL" ? "/api/v1/admin/ai-agent/drafts" : `/api/v1/admin/ai-agent/drafts?status=${filter}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const j = await r.json();
      setDrafts(j.items ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [filter]);

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <PageHeader
        title="NV IA — Borradores pendientes"
        description="Emails, mensajes y posts redactados por la IA. Revisa, aprueba para ejecutar, o rechaza."
      />

      <div className="mt-6 flex items-center justify-between">
        <div className="inline-flex rounded-lg border bg-white text-xs overflow-hidden">
          {(["PENDING", "EXECUTED", "REJECTED", "FAILED", "ALL"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={
                "px-3 py-1.5 " +
                (filter === s ? "bg-brand-600 text-white font-medium" : "text-slate-600 hover:bg-slate-50")
              }
            >
              {s === "ALL" ? "Todos" : s}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refrescar
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : drafts.length === 0 ? (
        <div className="mt-8 p-8 text-center text-sm text-slate-500 border rounded-xl bg-white">
          No hay borradores con este filtro.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft, onChanged }: { draft: Draft; onChanged: () => void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = KIND_ICON[draft.kind];

  async function approve() {
    if (!confirm(`¿Aprobar y ejecutar este ${KIND_LABEL[draft.kind].toLowerCase()}?`)) return;
    setBusy("approve");
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/ai-agent/drafts/${draft.id}/approve`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || `Error ${r.status}`);
      if (j.executionResult && !j.executionResult.ok) {
        setError(`Ejecución falló: ${j.executionResult.error ?? "error desconocido"}`);
      }
      onChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/ai-agent/drafts/${draft.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: rejectNote || undefined })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || `Error ${r.status}`);
      }
      setShowReject(false);
      setRejectNote("");
      onChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <div className="shrink-0 h-9 w-9 rounded-lg bg-violet-50 grid place-items-center text-violet-600">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">{KIND_LABEL[draft.kind]}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_STYLE[draft.status]}`}>
              {draft.status}
            </span>
            <span className="text-[10px] text-slate-400">
              {new Date(draft.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
            {draft.taskId && (
              <a href={`/tasks/${draft.taskId}`} className="text-[10px] text-brand-600 underline">
                ver tarea origen →
              </a>
            )}
          </div>
          <h3 className="font-medium text-sm text-slate-900 mt-1 truncate">{draft.title}</h3>
          <DraftPreview kind={draft.kind} payload={draft.payload} />
        </div>
      </div>

      {draft.executionResult && (
        <div
          className={
            "px-4 py-2 text-xs border-t " +
            (draft.executionResult.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-700")
          }
        >
          {draft.executionResult.ok ? (
            <>
              <CheckCircle2 className="h-3 w-3 inline mr-1" />
              Ejecutado{draft.executionResult.externalId ? ` — id externo: ${draft.executionResult.externalId}` : ""}
              {draft.executedAt && ` · ${new Date(draft.executedAt).toLocaleString("es-ES")}`}
            </>
          ) : (
            <>
              <XCircle className="h-3 w-3 inline mr-1" />
              Falló: {draft.executionResult.error}
            </>
          )}
        </div>
      )}
      {draft.reviewerNote && (
        <div className="px-4 py-2 text-xs border-t bg-slate-50 text-slate-700">
          <strong>Nota del revisor:</strong> {draft.reviewerNote}
        </div>
      )}

      {error && (
        <div className="px-4 py-2 text-xs border-t bg-rose-50 text-rose-700">
          <AlertCircle className="h-3 w-3 inline mr-1" /> {error}
        </div>
      )}

      {(draft.status === "PENDING" || draft.status === "FAILED") && (
        <div className="px-4 py-3 border-t bg-slate-50/50">
          {showReject ? (
            <div className="space-y-2">
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="(opcional) Por qué rechazas — la IA puede aprender de esto en el futuro"
                rows={2}
                className="w-full px-2 py-1.5 rounded border text-xs"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowReject(false)}
                  className="px-3 py-1.5 rounded border text-xs text-slate-600"
                >
                  Cancelar
                </button>
                <button
                  onClick={reject}
                  disabled={busy === "reject"}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-800 text-white text-xs disabled:opacity-50"
                >
                  {busy === "reject" && <Loader2 className="h-3 w-3 animate-spin" />}
                  Confirmar rechazo
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowReject(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border bg-white text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <XCircle className="h-3 w-3" /> Rechazar
              </button>
              <button
                onClick={approve}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
              >
                {busy === "approve" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {draft.status === "FAILED" ? "Reintentar" : "Aprobar y enviar"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DraftPreview({ kind, payload }: { kind: Kind; payload: any }) {
  if (kind === "EMAIL") {
    return (
      <div className="mt-2 text-xs text-slate-600 space-y-1">
        <div><strong>Para:</strong> {payload?.to}</div>
        <div><strong>Asunto:</strong> {payload?.subject}</div>
        <div className="bg-slate-50 p-2 rounded border whitespace-pre-wrap max-h-40 overflow-y-auto text-[11px]">
          {payload?.text ?? "(sin cuerpo)"}
        </div>
      </div>
    );
  }
  if (kind === "WHATSAPP") {
    return (
      <div className="mt-2 text-xs text-slate-600 space-y-1">
        <div><strong>Tel:</strong> +{payload?.phoneNormalized}</div>
        <div className="bg-emerald-50 p-2 rounded border-emerald-200 whitespace-pre-wrap max-h-32 overflow-y-auto text-[11px]">
          {payload?.text}
        </div>
      </div>
    );
  }
  if (kind === "EDITORIAL_POST") {
    return (
      <div className="mt-2 text-xs text-slate-600 space-y-1">
        <div><strong>Redes:</strong> {(payload?.networks ?? []).join(", ")}</div>
        <div className="bg-slate-50 p-2 rounded border whitespace-pre-wrap max-h-40 overflow-y-auto text-[11px]">
          {payload?.content}
        </div>
      </div>
    );
  }
  if (kind === "CALENDAR_EVENT") {
    const start = payload?.startIso ? new Date(payload.startIso) : null;
    const end = payload?.endIso ? new Date(payload.endIso) : null;
    return (
      <div className="mt-2 text-xs text-slate-600 space-y-1">
        <div>
          <strong>Inicio:</strong>{" "}
          {start ? start.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "?"}
          {end && ` → ${end.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}`}
          {payload?.allDay && " (todo el día)"}
        </div>
        <div><strong>Tipo:</strong> {payload?.type ?? "MEETING"}</div>
        {payload?.description && (
          <div className="bg-slate-50 p-2 rounded border whitespace-pre-wrap max-h-32 overflow-y-auto text-[11px]">
            {payload.description}
          </div>
        )}
      </div>
    );
  }
  return (
    <pre className="mt-2 text-[10px] bg-slate-50 p-2 rounded border overflow-x-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}
