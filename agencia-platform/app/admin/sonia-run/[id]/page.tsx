"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { Loader2, ArrowLeft, Wrench, MessageSquare, Brain, AlertCircle, CheckCircle2, Info, FileCode, AlertTriangle } from "lucide-react";

type LogStep =
  | { type: "start"; ts: string; taskId: string }
  | { type: "thinking"; ts: string; text: string }
  | { type: "text"; ts: string; text: string }
  | { type: "tool_use"; ts: string; tool: string; input: unknown; toolUseId: string }
  | { type: "tool_result"; ts: string; toolUseId: string; output: unknown; isError?: boolean }
  | { type: "stop"; ts: string; reason: string; summary?: string }
  | { type: "error"; ts: string; message: string }
  | { type: "info"; ts: string; text: string }
  | { type: "escalation"; ts: string; issueUrl: string; issueNumber: number };

type RunDetail = {
  id: string;
  taskId: string;
  task: { id: string; title: string; client: { name: string } | null } | null;
  status: string;
  trigger: string;
  triggerContext: string | null;
  model: string;
  summary: string | null;
  error: string | null;
  log: LogStep[];
  stepsCount: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  lastIterationAt: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  SUCCEEDED: "bg-emerald-100 text-emerald-800",
  REQUIRES_HUMAN: "bg-amber-100 text-amber-800",
  FAILED: "bg-rose-100 text-rose-800",
  RUNNING: "bg-violet-100 text-violet-800",
  PENDING: "bg-slate-100 text-slate-700"
};

export default function SoniaRunReplayPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedTools, setCollapsedTools] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!id) return;
    fetch(`/api/v1/admin/sonia-run/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [id]);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="max-w-4xl mx-auto p-4 text-slate-500 text-center">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Cargando run…
      </div>
    );
  }

  const duration =
    data.startedAt && data.finishedAt
      ? Math.round(
          (new Date(data.finishedAt).getTime() - new Date(data.startedAt).getTime()) / 1000
        )
      : null;

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/admin/sonia-dashboard"
        className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 mb-2"
      >
        <ArrowLeft className="h-3 w-3" /> Dashboard
      </Link>

      <PageHeader
        title="Replay del run"
        description={data.task?.title ?? "(task eliminada)"}
        actions={
          <span
            className={
              "inline-block px-2 py-0.5 rounded text-xs font-medium " +
              (STATUS_COLOR[data.status] ?? "bg-slate-100")
            }
          >
            {data.status}
          </span>
        }
      />

      {/* Header card */}
      <div className="bg-white border rounded-xl p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Field label="Trigger" value={data.trigger} />
        <Field label="Modelo" value={data.model} />
        <Field label="Steps" value={String(data.stepsCount)} />
        <Field
          label="Duración"
          value={duration !== null ? `${duration}s` : "—"}
        />
        <Field
          label="Tokens IN"
          value={data.inputTokens.toLocaleString()}
        />
        <Field
          label="Tokens OUT"
          value={data.outputTokens.toLocaleString()}
        />
        <Field
          label="Cliente"
          value={data.task?.client?.name ?? "—"}
        />
        <Field label="Task" value={data.task ? <Link href={`/tareas?task=${data.taskId}`} className="text-brand-600 hover:underline">Abrir →</Link> : "—"} />
      </div>

      {data.triggerContext && (
        <div className="bg-slate-50 border rounded-xl p-3 mb-4 text-xs text-slate-700">
          <strong>Contexto del trigger:</strong> {data.triggerContext}
        </div>
      )}

      {data.summary && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 text-sm whitespace-pre-wrap">
          <strong className="text-emerald-800">Resumen final:</strong>
          <div className="mt-1 text-emerald-900">{data.summary}</div>
        </div>
      )}

      {data.error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-4 text-sm whitespace-pre-wrap">
          <strong className="text-rose-800">Error:</strong>
          <div className="mt-1 text-rose-900 font-mono text-xs">{data.error}</div>
        </div>
      )}

      {/* Timeline */}
      <h2 className="font-semibold text-sm mb-3 px-1">Timeline ({data.log.length} eventos)</h2>
      <div className="space-y-2">
        {data.log.map((step, i) => (
          <LogStepCard
            key={i}
            step={step}
            i={i}
            collapsed={collapsedTools[String(i)] ?? true}
            onToggle={() =>
              setCollapsedTools((s) => ({ ...s, [String(i)]: !(s[String(i)] ?? true) }))
            }
          />
        ))}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function LogStepCard({
  step,
  i,
  collapsed,
  onToggle
}: {
  step: LogStep;
  i: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const ts = new Date(step.ts).toLocaleTimeString("es-ES", { hour12: false });
  switch (step.type) {
    case "start":
      return (
        <Row icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} color="emerald" ts={ts} i={i}>
          <strong>Run arrancó</strong> · task <code className="text-xs">{step.taskId}</code>
        </Row>
      );
    case "thinking":
      return (
        <Row icon={<Brain className="h-4 w-4 text-violet-600" />} color="violet" ts={ts} i={i}>
          <div className="text-xs text-violet-700 italic mb-1">Pensamiento interno</div>
          <div className="text-sm whitespace-pre-wrap text-slate-700">{step.text}</div>
        </Row>
      );
    case "text":
      return (
        <Row icon={<MessageSquare className="h-4 w-4 text-blue-600" />} color="blue" ts={ts} i={i}>
          <div className="text-sm whitespace-pre-wrap">{step.text}</div>
        </Row>
      );
    case "tool_use":
      return (
        <Row icon={<Wrench className="h-4 w-4 text-amber-600" />} color="amber" ts={ts} i={i}>
          <button
            type="button"
            onClick={onToggle}
            className="text-left w-full"
          >
            <div className="flex items-center gap-2">
              <code className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                {step.tool}
              </code>
              <span className="text-xs text-slate-500">{collapsed ? "▸" : "▾"}</span>
            </div>
          </button>
          {!collapsed && (
            <pre className="text-[11px] bg-slate-50 border rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          )}
        </Row>
      );
    case "tool_result":
      return (
        <Row
          icon={
            step.isError ? (
              <AlertCircle className="h-4 w-4 text-rose-600" />
            ) : (
              <FileCode className="h-4 w-4 text-slate-600" />
            )
          }
          color={step.isError ? "rose" : "slate"}
          ts={ts}
          i={i}
        >
          <button type="button" onClick={onToggle} className="text-left w-full">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                Resultado {step.isError && <span className="text-rose-600 font-medium">(error)</span>}
              </span>
              <span className="text-xs text-slate-500">{collapsed ? "▸" : "▾"}</span>
            </div>
          </button>
          {!collapsed && (
            <pre className="text-[11px] bg-slate-50 border rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
              {typeof step.output === "string"
                ? step.output
                : JSON.stringify(step.output, null, 2)}
            </pre>
          )}
        </Row>
      );
    case "stop":
      return (
        <Row icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} color="emerald" ts={ts} i={i}>
          <strong>Stop:</strong> {step.reason}
          {step.summary && <div className="mt-1 text-xs">{step.summary}</div>}
        </Row>
      );
    case "error":
      return (
        <Row icon={<AlertCircle className="h-4 w-4 text-rose-600" />} color="rose" ts={ts} i={i}>
          <strong className="text-rose-800">Error:</strong>
          <div className="text-xs font-mono text-rose-900 mt-1">{step.message}</div>
        </Row>
      );
    case "info":
      return (
        <Row icon={<Info className="h-4 w-4 text-slate-500" />} color="slate" ts={ts} i={i}>
          <span className="text-xs text-slate-600">{step.text}</span>
        </Row>
      );
    case "escalation":
      return (
        <Row icon={<AlertTriangle className="h-4 w-4 text-orange-600" />} color="orange" ts={ts} i={i}>
          <strong>Escalado a Claude Code:</strong>{" "}
          <a
            href={step.issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 underline"
          >
            #{step.issueNumber}
          </a>
        </Row>
      );
    default:
      return null;
  }
}

function Row({
  icon,
  color,
  ts,
  i,
  children
}: {
  icon: React.ReactNode;
  color: string;
  ts: string;
  i: number;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-white border-l-4 border-${color}-400 border-y border-r rounded-r-lg p-3 flex gap-3`}>
      <div className="flex-shrink-0 flex flex-col items-center gap-1">
        {icon}
        <div className="text-[10px] text-slate-400">{ts}</div>
      </div>
      <div className="flex-1 min-w-0 text-sm">
        <div className="text-[10px] text-slate-300 mb-0.5">#{i + 1}</div>
        {children}
      </div>
    </div>
  );
}
