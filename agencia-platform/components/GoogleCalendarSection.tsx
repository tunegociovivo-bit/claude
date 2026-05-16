"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, RefreshCw, Unplug, AlertTriangle, Calendar } from "lucide-react";

type State = {
  connected: boolean;
  googleAccountEmail: string | null;
  pullEnabled: boolean | null;
  pushEnabled: boolean | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  configured: boolean;
  pushChannel?: { active: boolean; expiresAt: string | null };
};

const FEEDBACK: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Google Calendar conectado correctamente." },
  denied: { tone: "error", text: "Cancelaste el permiso en Google." },
  invalid: { tone: "error", text: "Respuesta de Google sin code/state." },
  bad_state: { tone: "error", text: "Estado inválido. Reinicia desde aquí." },
  expired_state: { tone: "error", text: "El flujo tardó demasiado. Reintenta." },
  no_refresh: {
    tone: "error",
    text: "Google no devolvió refresh_token. Ve a https://myaccount.google.com/permissions, revoca el acceso de Hub y vuelve a conectar."
  },
  failed: { tone: "error", text: "Algo falló en el intercambio de tokens." }
};

export default function GoogleCalendarSection() {
  const params = useSearchParams();
  const gcal = params.get("gcal");
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/v1/me/google-calendar");
    if (r.ok) setState(await r.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function disconnect() {
    if (!confirm("¿Desconectar Google Calendar?\n\nLos eventos ya importados se mantienen en el Hub.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/integrations/google-calendar/disconnect", { method: "DELETE" });
      if (r.ok) load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(field: "pullEnabled" | "pushEnabled") {
    if (!state) return;
    setBusy(true);
    try {
      const r = await fetch("/api/v1/me/google-calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !state[field] })
      });
      if (r.ok) load();
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const feedback = gcal ? FEEDBACK[gcal] : null;

  return (
    <div className="bg-white rounded-xl border p-5 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Calendar className="h-4 w-4 text-brand-600" />
        <h3 className="text-sm font-semibold text-slate-900">Google Calendar (bidireccional)</h3>
      </div>
      <p className="text-[12px] text-slate-500 mb-4">
        Los eventos del Hub aparecen en tu Google Calendar y viceversa. Los cambios se propagan
        automáticamente — los del Hub al instante, los de Google cada 15 min.
      </p>

      {feedback && (
        <div
          className={
            "mb-3 rounded-md px-3 py-2 text-xs inline-flex items-start gap-2 " +
            (feedback.tone === "ok"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200")
          }
        >
          {feedback.tone === "ok" ? (
            <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          )}
          {feedback.text}
        </div>
      )}

      {!state.configured ? (
        <p className="text-xs text-slate-500 italic">
          El administrador del workspace todavía no ha configurado GOOGLE_CLIENT_ID/SECRET. Pídele que los añada
          en variables de entorno para habilitar la integración.
        </p>
      ) : !state.connected ? (
        <a
          href="/api/integrations/google-calendar/connect"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm"
        >
          <Calendar className="h-4 w-4" />
          Conectar mi Google Calendar
        </a>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-slate-700">
            Conectado como{" "}
            <span className="font-medium text-slate-900">{state.googleAccountEmail}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            {state.lastSyncedAt
              ? `Última sincronización: ${new Date(state.lastSyncedAt).toLocaleString("es-ES")}`
              : "Aún sin sincronizar — la próxima ejecución del cron (cada 15 min) traerá tus eventos."}
            {state.lastError && (
              <span className="block text-rose-600 mt-1">Último error: {state.lastError}</span>
            )}
            {state.pushChannel?.active ? (
              <span className="block text-emerald-600 mt-1">
                ✓ Notificaciones push activas. Los cambios en Google llegan al instante (canal caduca{" "}
                {state.pushChannel.expiresAt
                  ? new Date(state.pushChannel.expiresAt).toLocaleDateString("es-ES")
                  : "—"}
                ; se renueva solo).
              </span>
            ) : (
              <span className="block text-amber-700 mt-1">
                Push notifications inactivas: tu admin debe verificar el dominio en Google Search Console
                + Cloud Console para que Google nos avise al instante. Mientras tanto, polling cada 15 min.
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={state.pullEnabled ?? true}
                onChange={() => toggle("pullEnabled")}
                disabled={busy}
              />
              Importar eventos de Google al Hub
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={state.pushEnabled ?? true}
                onChange={() => toggle("pushEnabled")}
                disabled={busy}
              />
              Enviar mis eventos del Hub a Google
            </label>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <a
              href="/api/integrations/google-calendar/connect"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-slate-700 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-autorizar
            </a>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
              Desconectar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
