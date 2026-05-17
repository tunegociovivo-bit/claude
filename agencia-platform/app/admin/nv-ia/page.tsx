"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Bot, Loader2, PlayCircle, RefreshCw, AlertCircle, CheckCircle2, Inbox } from "lucide-react";

type Status = {
  configured: boolean;
  aiUser?: { id: string; name: string | null; email: string };
  inboxProject?: { id: string; name: string; deletedAt: string | null };
  config?: {
    userId: string;
    inboxProjectId: string;
    model: string;
    maxStepsPerRun: number;
    maxTokensPerRun: number;
  };
  runCounts?: Record<string, number>;
};

type Run = {
  id: string;
  taskId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "REQUIRES_HUMAN";
  model: string;
  summary: string | null;
  error: string | null;
  stepsCount: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

const STATUS_STYLE: Record<Run["status"], string> = {
  PENDING: "bg-slate-100 text-slate-700",
  RUNNING: "bg-sky-100 text-sky-700",
  SUCCEEDED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-rose-100 text-rose-700",
  REQUIRES_HUMAN: "bg-amber-100 text-amber-700"
};

export default function NvIaAdminPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [initing, setIniting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    try {
      const [sR, rR] = await Promise.all([
        fetch("/api/v1/admin/ai-agent/init", { cache: "no-store" }),
        fetch("/api/v1/admin/ai-agent/runs?limit=20", { cache: "no-store" })
      ]);
      if (sR.ok) setStatus(await sR.json());
      if (rR.ok) {
        const j = await rR.json();
        setRuns(j.items ?? []);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function initialize() {
    setIniting(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/ai-agent/init", { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || `Error ${r.status}`);
      }
      await loadStatus();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setIniting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <PageHeader
        title="NV IA — Trabajador autónomo"
        description="Crea un user 'NV IA' y un proyecto buzón. Cualquier tarea que enlaces a ese proyecto se procesa automáticamente."
      />

      {error && (
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando estado…
        </div>
      ) : !status?.configured ? (
        <div className="mt-6 rounded-xl border bg-white p-6">
          <h2 className="font-semibold text-slate-900 mb-2">NV IA aún no está inicializada en este workspace</h2>
          <p className="text-sm text-slate-600 mb-4">
            Al inicializar se crea:
          </p>
          <ul className="text-sm text-slate-600 space-y-1 mb-4 list-disc list-inside">
            <li>Un usuario <strong>NV IA</strong> (sistema, no puede hacer login).</li>
            <li>Un proyecto <strong>🤖 NV IA — Tareas IA</strong> como buzón.</li>
            <li>Configuración con tope de 25 pasos y 200K tokens por tarea.</li>
          </ul>
          <p className="text-xs text-slate-500 mb-4">
            <strong>Requisito:</strong> debes tener la API key de Anthropic configurada en{" "}
            <a href="/admin/ai" className="text-brand-600 underline">/admin/ai</a> o en la env var <code>ANTHROPIC_API_KEY</code>.
          </p>
          <button
            onClick={initialize}
            disabled={initing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {initing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Inicializar NV IA
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid sm:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-slate-500 mb-1">Usuario IA</div>
              <div className="font-semibold text-sm">{status.aiUser?.name}</div>
              <div className="text-xs text-slate-500">{status.aiUser?.email}</div>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-slate-500 mb-1">Proyecto buzón</div>
              <div className="font-semibold text-sm">{status.inboxProject?.name}</div>
              <a
                href={`/projects/${status.inboxProject?.id}`}
                className="text-xs text-brand-600 underline"
              >
                Abrir proyecto →
              </a>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-slate-500 mb-1">Modelo / límites</div>
              <div className="font-mono text-xs">{status.config?.model}</div>
              <div className="text-xs text-slate-500">
                {status.config?.maxStepsPerRun} pasos · {(status.config?.maxTokensPerRun ?? 0) / 1000}K tokens / run
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {Object.entries(status.runCounts ?? {}).map(([s, n]) => (
                <span key={s} className={`px-2 py-0.5 rounded ${STATUS_STYLE[s as Run["status"]] ?? "bg-slate-100"}`}>
                  {s}: {n}
                </span>
              ))}
            </div>
            <a
              href="/admin/nv-ia/drafts"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium"
            >
              <Inbox className="h-3.5 w-3.5" />
              Borradores pendientes →
            </a>
          </div>

          <div className="mt-8 rounded-xl border bg-white">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold text-sm">Runs recientes</h2>
              <button
                onClick={loadStatus}
                className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refrescar
              </button>
            </div>
            {runs.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Aún no hay runs. Crea una tarea en cualquier proyecto, ábrela y enlázala al proyecto{" "}
                <strong>{status.inboxProject?.name}</strong> desde "Compartir con proyecto".
              </div>
            ) : (
              <div className="divide-y">
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 text-xs text-slate-500 space-y-1">
            <p>
              <strong>Para que los runs se ejecuten:</strong> programa una llamada periódica a{" "}
              <code>GET /api/cron/ai-agent/process?secret=$CRON_SECRET</code> cada 1-2 minutos
              (Railway cron / GitHub Actions).
            </p>
            <p>
              <strong>Tools disponibles (13):</strong>
              <br />
              <strong>Lectura:</strong> get_task_context, list_task_files, read_file_content (PDF/DOCX/XLSX/TXT),
              search_tasks, search_knowledge (RAG semántico), get_calendar_events.
              <br />
              <strong>Escritura inmediata:</strong> add_comment, update_task_status, mark_complete.
              <br />
              <strong>Borradores (requieren aprobación):</strong> draft_email, draft_whatsapp, draft_editorial_post,
              draft_calendar_event. Se aprueban en{" "}
              <a href="/admin/nv-ia/drafts" className="text-brand-600 underline">/admin/nv-ia/drafts</a>.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function RunRow({ run }: { run: Run }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="p-4 hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded((e) => !e)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_STYLE[run.status]}`}>
            {run.status}
          </span>
          <a
            href={`/tasks/${run.taskId}`}
            className="font-mono text-xs text-brand-600 hover:underline truncate"
            onClick={(e) => e.stopPropagation()}
          >
            task:{run.taskId.slice(0, 10)}
          </a>
          <span className="text-xs text-slate-500 truncate">
            {run.summary ?? run.error ?? "(sin resumen)"}
          </span>
        </div>
        <div className="text-[10px] text-slate-400 shrink-0 font-mono">
          {run.stepsCount}p · {(run.inputTokens + run.outputTokens) / 1000}K tok
        </div>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2 text-xs">
          <div>
            <span className="text-slate-500">Inicio:</span> {run.startedAt ?? "—"}
          </div>
          <div>
            <span className="text-slate-500">Fin:</span> {run.finishedAt ?? "—"}
          </div>
          {run.summary && (
            <div className="bg-emerald-50 p-2 rounded">
              <CheckCircle2 className="h-3 w-3 inline text-emerald-600 mr-1" /> {run.summary}
            </div>
          )}
          {run.error && (
            <div className="bg-rose-50 p-2 rounded text-rose-700">
              <AlertCircle className="h-3 w-3 inline mr-1" /> {run.error}
            </div>
          )}
          <a
            href={`/api/v1/admin/ai-agent/runs/${run.id}`}
            target="_blank"
            className="text-brand-600 underline text-[11px]"
          >
            Ver log completo (JSON) →
          </a>
        </div>
      )}
    </div>
  );
}
