"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Bot, Loader2, PlayCircle, RefreshCw, AlertCircle, CheckCircle2, Inbox, BarChart3 } from "lucide-react";

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

type ProactiveCfg = {
  enabled: boolean;
  deadlineHours: number;
  staleDays: number;
  maxRunsPerCron: number;
};

type InboundCfg = {
  email: { enabled: boolean; webhookToken: string | null };
  whatsapp: { enabled: boolean };
  call: { enabled: boolean; webhookToken: string | null };
};

export default function NvIaAdminPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [proactive, setProactive] = useState<ProactiveCfg | null>(null);
  const [savingProactive, setSavingProactive] = useState(false);
  const [inbound, setInbound] = useState<InboundCfg | null>(null);
  const [savingInbound, setSavingInbound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initing, setIniting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    try {
      const [sR, rR, pR, iR] = await Promise.all([
        fetch("/api/v1/admin/ai-agent/init", { cache: "no-store" }),
        fetch("/api/v1/admin/ai-agent/runs?limit=20", { cache: "no-store" }),
        fetch("/api/v1/admin/ai-agent/proactive", { cache: "no-store" }),
        fetch("/api/v1/admin/ai-agent/inbound", { cache: "no-store" })
      ]);
      if (sR.ok) setStatus(await sR.json());
      if (rR.ok) {
        const j = await rR.json();
        setRuns(j.items ?? []);
      }
      if (pR.ok) setProactive(await pR.json());
      if (iR.ok) setInbound(await iR.json());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function saveProactive(next: ProactiveCfg) {
    setSavingProactive(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/ai-agent/proactive", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || `Error ${r.status}`);
      }
      const j = await r.json();
      setProactive(j.proactive);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSavingProactive(false);
    }
  }

  async function saveInbound(next: Partial<{ email: { enabled: boolean; webhookToken?: string | null }; whatsapp: { enabled: boolean }; call: { enabled: boolean } }>) {
    setSavingInbound(true);
    setError(null);
    try {
      // El endpoint PUT solo necesita {enabled} — strip webhookToken
      // del body por si llega (el back lo gestiona internamente).
      const body: any = {};
      if (next.email) body.email = { enabled: next.email.enabled };
      if (next.whatsapp) body.whatsapp = { enabled: next.whatsapp.enabled };
      if (next.call) body.call = { enabled: next.call.enabled };
      const r = await fetch("/api/v1/admin/ai-agent/inbound", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || `Error ${r.status}`);
      }
      const j = await r.json();
      const inb = j.inbound ?? {};
      setInbound({
        email: { enabled: inb.email?.enabled ?? false, webhookToken: inb.email?.webhookToken ?? null },
        whatsapp: { enabled: inb.whatsapp?.enabled ?? false },
        call: { enabled: inb.call?.enabled ?? false, webhookToken: inb.call?.webhookToken ?? null }
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSavingInbound(false);
    }
  }

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
        title="Sonia — Trabajador autónomo"
        description="Crea un user 'Sonia' y un proyecto buzón. Cualquier tarea que enlaces a ese proyecto se procesa automáticamente."
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
          <h2 className="font-semibold text-slate-900 mb-2">Sonia aún no está inicializada en este workspace</h2>
          <p className="text-sm text-slate-600 mb-4">
            Al inicializar se crea:
          </p>
          <ul className="text-sm text-slate-600 space-y-1 mb-4 list-disc list-inside">
            <li>Un usuario <strong>Sonia</strong> (sistema, no puede hacer login).</li>
            <li>Un proyecto <strong>🤖 Sonia — Tareas IA</strong> como buzón.</li>
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
            Inicializar Sonia
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
            <div className="flex items-center gap-2">
              <a
                href="/admin/nv-ia/insights"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Insights
              </a>
              <a
                href="/admin/nv-ia/drafts"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium"
              >
                <Inbox className="h-3.5 w-3.5" />
                Borradores pendientes →
              </a>
            </div>
          </div>

          {proactive && (
            <div className="mt-6 rounded-xl border bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-sm">Proactividad — Sonia se dispara sola</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Cuando está activa, un cron revisa cada 15-60 min las tareas con deadline próximo
                    o estancadas y Sonia deja un comentario con plan/aviso. Dedupe 24h por tarea.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={proactive.enabled}
                    disabled={savingProactive}
                    onChange={(e) => saveProactive({ ...proactive, enabled: e.target.checked })}
                    className="accent-violet-600 h-4 w-4"
                  />
                  <span className="text-sm font-medium">{proactive.enabled ? "Activa" : "Inactiva"}</span>
                </label>
              </div>
              {proactive.enabled && (
                <div className="grid sm:grid-cols-3 gap-3 mt-2 text-xs">
                  <div>
                    <label className="block text-slate-600 mb-1">Aviso si vence en próximas (horas)</label>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={proactive.deadlineHours}
                      onChange={(e) => setProactive({ ...proactive, deadlineHours: Number(e.target.value) })}
                      onBlur={() => saveProactive(proactive)}
                      className="w-full px-2 py-1.5 rounded border text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">"Estancada" si IN_PROGRESS sin updates (días)</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={proactive.staleDays}
                      onChange={(e) => setProactive({ ...proactive, staleDays: Number(e.target.value) })}
                      onBlur={() => saveProactive(proactive)}
                      className="w-full px-2 py-1.5 rounded border text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Tope de runs por ejecución del cron</label>
                    <input
                      type="number"
                      min={1}
                      max={25}
                      value={proactive.maxRunsPerCron}
                      onChange={(e) => setProactive({ ...proactive, maxRunsPerCron: Number(e.target.value) })}
                      onBlur={() => saveProactive(proactive)}
                      className="w-full px-2 py-1.5 rounded border text-xs"
                    />
                  </div>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-3">
                <strong>Para que funcione:</strong> programa una llamada periódica (cada 15-60 min) a{" "}
                <code>GET /api/cron/ai-agent/proactive?secret=$CRON_SECRET</code>.
              </p>
            </div>
          )}

          {inbound && (
            <div className="mt-6 rounded-xl border bg-white p-4">
              <h2 className="font-semibold text-sm">Entrada externa — clientes contactan y Sonia atiende</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                Cuando un cliente envía email o WhatsApp, Sonia crea una tarea en el buzón con el contenido y
                redacta una propuesta de respuesta para tu aprobación. Lo más cerca de "secretaria automática".
              </p>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-slate-50/50">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">💬 WhatsApp entrante</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Cuando un lead/cliente responde a WhatsApp (clasificado como interesado, objeción o info_request)
                      Sonia recibe el mensaje y prepara draft. Requiere tener Leads/WAHA configurado.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={inbound.whatsapp.enabled}
                      disabled={savingInbound}
                      onChange={(e) => saveInbound({ whatsapp: { enabled: e.target.checked } })}
                      className="accent-violet-600 h-4 w-4"
                    />
                    <span className="text-xs font-medium">{inbound.whatsapp.enabled ? "Activo" : "Inactivo"}</span>
                  </label>
                </div>

                <div className="p-3 rounded-lg border bg-slate-50/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">📧 Email entrante</div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Configura tu proveedor de email (Resend Inbound, ImprovMX, Postmark, etc.) para hacer POST
                        a la URL de abajo. Sonia crea una tarea y prepara draft de respuesta.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={inbound.email.enabled}
                        disabled={savingInbound}
                        onChange={(e) => saveInbound({ email: { enabled: e.target.checked, webhookToken: inbound.email.webhookToken } })}
                        className="accent-violet-600 h-4 w-4"
                      />
                      <span className="text-xs font-medium">{inbound.email.enabled ? "Activo" : "Inactivo"}</span>
                    </label>
                  </div>
                  {inbound.email.enabled && inbound.email.webhookToken && (
                    <div className="mt-3">
                      <label className="block text-[11px] text-slate-600 mb-1">URL del webhook (configúrala en tu proveedor):</label>
                      <code className="block text-[11px] bg-white border rounded px-2 py-1.5 break-all">
                        {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/inbound-email/{inbound.email.webhookToken}
                      </code>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Acepta JSON con campos: <code>from, to, subject, text/html, messageId</code>. Compatible con
                        Resend Inbound, ImprovMX, Postmark Inbound Parse y similares.
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-lg border bg-slate-50/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">📞 Llamadas entrantes</div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Manda la transcripción de cada llamada (desde Make, Twilio, Aircall, etc.) a la URL de abajo.
                        Sonia crea la tarea en el Hub, propone las acciones que puede hacer y te avisa por voz.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={inbound.call.enabled}
                        disabled={savingInbound}
                        onChange={(e) => saveInbound({ call: { enabled: e.target.checked } })}
                        className="accent-violet-600 h-4 w-4"
                      />
                      <span className="text-xs font-medium">{inbound.call.enabled ? "Activo" : "Inactivo"}</span>
                    </label>
                  </div>
                  {inbound.call.enabled && inbound.call.webhookToken && (
                    <div className="mt-3">
                      <label className="block text-[11px] text-slate-600 mb-1">URL del webhook (pégala en Make):</label>
                      <code className="block text-[11px] bg-white border rounded px-2 py-1.5 break-all">
                        {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/inbound-call/{inbound.call.webhookToken}
                      </code>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Acepta JSON con campos: <code>from, transcript, durationSec, recordingUrl, callSid</code>.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 rounded-xl border bg-white">
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
              <strong>Tools disponibles (35):</strong>
              <br />
              <strong>Lectura (29):</strong> contexto + archivos + visión + voz + Drive + RAG
              + calendario + equipo + memoria 3-capas + web + Holded (invoices/contacts/quotes)
              + Stripe (customers/invoices) + Metricool (brands/stats) + Meta Ads
              (ad_accounts/campaigns/insights/top) + Google Ads (campaigns/metrics).
              <br />
              <strong>Escritura inmediata (12):</strong> add_comment, update_task_status,
              update_client_memory, update_workspace_memory, update_user_memory, assign_task,
              create_subtask, notify_user, tag_task, set_task_due_date, set_task_priority,
              mark_complete.
              <br />
              <strong>Borradores (9, requieren aprobación salvo auto-approve por cliente):</strong>{" "}
              draft_email, draft_whatsapp, draft_editorial_post, draft_calendar_event,
              draft_drive_file, draft_gmb_post, draft_holded_invoice, draft_holded_quote,
              draft_stripe_payment_link. Se aprueban en{" "}
              <a href="/admin/nv-ia/drafts" className="text-brand-600 underline">/admin/nv-ia/drafts</a>.
              <br />
              <strong>Análisis cruzado y auto-mejora (4):</strong> query_knowledge_graph (búsqueda
              cruzada con filtros cliente/sector/fecha), propose_new_tool (Sonia propone nuevas
              tools cuando detecta patrones repetitivos), start_client_workflow (secuencias
              automáticas tipo onboarding 7d / renewal 30d / churn recovery 14d), generate_image
              (gpt-image-1 → adjunto a la task).
              <br />
              <strong>Delegación interna y avanzado (2):</strong> spawn_subagent (sub-IAs read-only
              para tareas grandes), code_execution (Python sandbox de Anthropic para cálculos).
            </p>
            <p className="mt-3">
              <strong>Triggers (15):</strong> Manual, @mention, Proactive (deadline/stale),
              Scheduled, Email/WhatsApp/Call inbound, Strategic Review (Co-CEO), Owner Mode Check,
              Compliance Flag, Lead Opportunity, Workflow Step (Fase 41), Churn Risk (Fase 43),
              Self-Healing (Fase 44).
            </p>
            <p>
              <strong>Cómo invocarla:</strong> (a) enlazando una tarea al proyecto buzón <em>🤖 Sonia — Tareas IA</em>;
              o (b) mencionándola con <code>@nv-ia</code> en cualquier comentario.
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
