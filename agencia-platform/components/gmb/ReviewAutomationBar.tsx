"use client";

/**
 * Barra de automatización de reseñas de una ficha: respuesta automática (manual / positivas /
 * negativas / ambas), avisos por email de reseñas nuevas (no / positivas / negativas / ambas),
 * emails de aviso y botón para responder ya las pendientes según el modo.
 */
import { useEffect, useState } from "react";
import { Bot, Loader2, Mail, Zap } from "lucide-react";

type Mode = "manual" | "positive" | "negative" | "both";
type Notify = "none" | "positive" | "negative" | "both";

const REPLY_OPTS: [Mode, string][] = [
  ["manual", "Manual"],
  ["positive", "Solo positivas"],
  ["negative", "Solo negativas"],
  ["both", "Ambas"]
];
const NOTIFY_OPTS: [Notify, string][] = [
  ["none", "No avisar"],
  ["positive", "Solo positivas"],
  ["negative", "Solo negativas"],
  ["both", "Ambas"]
];

function Seg<T extends string>({ value, options, onChange, disabled }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border bg-white p-0.5">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => onChange(k)}
          className={`px-2 py-1 rounded-md text-[11px] ${value === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"} disabled:opacity-50`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function ReviewAutomationBar({ id, onReplied }: { id: string; onReplied?: () => void }) {
  const [mode, setMode] = useState<Mode>("manual");
  const [notify, setNotify] = useState<Notify>("negative");
  const [emails, setEmails] = useState("");
  const [savedEmails, setSavedEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/gmb/clients/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const c = d?.client;
        if (!c) return;
        setMode(c.autoReply === "auto" ? "positive" : ["manual", "positive", "negative", "both"].includes(c.autoReply) ? c.autoReply : "manual");
        setNotify(["none", "positive", "negative", "both"].includes(c.notifyMode) ? c.notifyMode : "negative");
        setEmails(c.emails ?? "");
        setSavedEmails(c.emails ?? "");
      })
      .finally(() => setLoaded(true));
  }, [id]);

  async function save(patch: Record<string, any>, okMsg: string) {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error("No se pudo guardar");
      setMsg(okMsg);
      return true;
    } catch (e: any) {
      setMsg(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function replyPending() {
    if (mode === "manual") return;
    const label = REPLY_OPTS.find(([k]) => k === mode)?.[1].toLowerCase();
    if (!window.confirm(`Se van a responder con IA y publicar en Google las reseñas sin responder (${label}), hasta 25 por tanda. ¿Continuar?`)) return;
    setRunning(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/reviews/auto-reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) throw new Error(d.message || d?.error?.message || "No se pudo responder");
      setMsg(
        `Respondidas ${d.replied} reseñas${d.failed ? ` · ${d.failed} con error (${(d.errors ?? [])[0] ?? ""})` : ""}${d.remaining ? ` · quedan ${d.remaining} (vuelve a pulsar)` : ""}.`
      );
      onReplied?.();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setRunning(false);
    }
  }

  if (!loaded) return null;
  return (
    <div className="bg-white border rounded-xl p-3 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-medium text-slate-700 w-40">
          <Bot className="h-3.5 w-3.5 text-brand-600" /> Respuesta automática
        </span>
        <Seg
          value={mode}
          options={REPLY_OPTS}
          disabled={saving}
          onChange={async (v) => {
            const prev = mode;
            setMode(v);
            const ok = await save(
              { autoReply: v },
              v === "manual" ? "Respuesta automática desactivada: respondes tú." : "Guardado: las reseñas nuevas que lleguen se responderán solas con IA."
            );
            if (!ok) setMode(prev);
          }}
        />
        {mode !== "manual" && (
          <button
            type="button"
            onClick={replyPending}
            disabled={running}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
            title="Responder ya las reseñas sin responder que cubre el modo elegido"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Responder ahora las pendientes
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-medium text-slate-700 w-40">
          <Mail className="h-3.5 w-3.5 text-brand-600" /> Aviso por email
        </span>
        <Seg
          value={notify}
          options={NOTIFY_OPTS}
          disabled={saving}
          onChange={async (v) => {
            const prev = notify;
            setNotify(v);
            const ok = await save({ notifyMode: v }, v === "none" ? "Avisos por email desactivados." : "Guardado: se avisará por email cuando llegue una reseña de ese tipo.");
            if (!ok) setNotify(prev);
          }}
        />
        {notify !== "none" && (
          <form
            className="flex items-center gap-1 flex-1 min-w-[220px]"
            onSubmit={(e) => {
              e.preventDefault();
              save({ emails: emails.trim() }, "Emails de aviso guardados.").then((ok) => ok && setSavedEmails(emails.trim()));
            }}
          >
            <input
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="email@negocio.com, otro@agencia.com"
              className="flex-1 border rounded-md px-2 py-1 text-[12px]"
            />
            {emails.trim() !== savedEmails.trim() && (
              <button type="submit" disabled={saving} className="px-2 py-1 rounded-md border bg-white hover:bg-slate-50">
                Guardar
              </button>
            )}
          </form>
        )}
      </div>
      <div className="text-[10px] text-slate-400">
        Positivas = 4-5★ · negativas = 1-3★. El Hub revisa las reseñas nuevas cada 30 minutos.
        {notify !== "none" && !emails.trim() ? " Sin emails aquí se usa el email de avisos de Ajustes." : ""}
      </div>
      {msg && <div className="text-[11px] text-slate-700">{msg}</div>}
    </div>
  );
}
