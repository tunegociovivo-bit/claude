"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Check, Copy, CornerUpRight, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { jsonFetch } from "@/components/inbox/ui";
import { forwardButtonLabel, LEAD_COLOR_OPTIONS, toneOf } from "@/components/inbox/leads-ui";

type Status = { id?: string; label: string; color: string };
type Target = { id?: string; label: string; phone: string };
type State = { enabled: boolean; statuses?: Status[]; forwardTargets?: Target[]; intakeUrl?: string; isAdmin?: boolean };

function displayPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("34") && d.length === 11) return `+34 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d ? `+${d}` : phone;
}

const MAKE_EXAMPLE = `{
  "telefono": "{{1.data.phone_number}}",
  "nombre": "{{1.data.full_name}}",
  "email": "{{1.data.correo_electrónico}}",
  "linea": "609517110",
  "tratamiento": "Injerto capilar",
  "campana": "{{1.campaignName}}",
  "lead_id": "{{1.leadgenId}}",
  "respuestas": { "¿Cuándo te lo harías?": "{{1.data.…}}" }
}`;

// Ajustes del módulo «Leads y reenvíos»: botones ENVIAR A, estados del lead y
// URL de entrada para los escenarios de Make. Solo aparece si el módulo está activo.
export default function LeadsSettingsCard() {
  const [state, setState] = useState<State | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [busy, setBusy] = useState<"" | "targets" | "statuses" | "token">("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string; where: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const { ok, data } = await jsonFetch<State>("/api/v1/settings/leads");
    if (!ok) return setState({ enabled: false });
    setState(data);
    setTargets((data.forwardTargets ?? []).map((t) => ({ ...t, phone: displayPhone(t.phone) })));
    setStatuses(data.statuses ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  if (!state?.enabled) return null;
  const isAdmin = Boolean(state.isAdmin);

  async function save(kind: "targets" | "statuses" | "token") {
    setBusy(kind);
    setMsg(null);
    const body =
      kind === "targets"
        ? { forwardTargets: targets.filter((t) => t.label.trim() || t.phone.trim()) }
        : kind === "statuses"
          ? { statuses: statuses.filter((s) => s.label.trim()) }
          : { regenerateToken: true };
    const { ok, data } = await jsonFetch<any>("/api/v1/settings/leads", { method: "PUT", body: JSON.stringify(body) });
    setBusy("");
    if (!ok) {
      setMsg({ tone: "error", text: typeof data?.error === "string" ? data.error : "No se pudo guardar", where: kind });
      return;
    }
    setState(data);
    setTargets((data.forwardTargets ?? []).map((t: Target) => ({ ...t, phone: displayPhone(t.phone) })));
    setStatuses(data.statuses ?? []);
    setMsg({ tone: "ok", text: kind === "token" ? "Nueva URL creada: actualízala en Make" : "Guardado", where: kind });
  }

  function moveStatus(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= statuses.length) return;
    const next = [...statuses];
    [next[i], next[j]] = [next[j], next[i]];
    setStatuses(next);
  }

  const note = (where: string) =>
    msg && msg.where === where ? (
      <p className={clsx("text-xs", msg.tone === "ok" ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>
    ) : null;

  return (
    <section className="card space-y-6 p-4 sm:p-6" id="leads">
      <div>
        <h2 className="font-semibold">Leads y reenvíos</h2>
        <p className="text-xs text-slate-500">Botones para reenviar mensajes desde el chat, estados de cada lead y entrada de leads desde Make.</p>
      </div>

      {/* ---- ENVIAR A ---- */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Botones «ENVIAR A»</h3>
          <p className="text-xs text-slate-500">
            En un chat, selecciona fotos, audios, archivos o textos y reenvíalos a estos teléfonos. Salen desde el mismo número por el que
            hablas con el cliente.
          </p>
        </div>
        {targets.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Todavía no hay destinos.</p>}
        <div className="space-y-2">
          {targets.map((t, i) => (
            <div key={t.id ?? `new-${i}`} className="rounded-xl border border-slate-200 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="block text-xs font-medium text-slate-600">
                  Nombre del botón
                  <input
                    className="input mt-1"
                    value={t.label}
                    maxLength={30}
                    disabled={!isAdmin}
                    placeholder="TURCAS"
                    onChange={(e) => setTargets(targets.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Teléfono (con prefijo si no es de España)
                  <input
                    className="input mt-1"
                    type="tel"
                    inputMode="tel"
                    value={t.phone}
                    disabled={!isAdmin}
                    placeholder="+90 530 432 37 29"
                    onChange={(e) => setTargets(targets.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)))}
                  />
                </label>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn-ghost h-10 text-red-600 hover:bg-red-50"
                    onClick={() => setTargets(targets.filter((_, k) => k !== i))}
                    aria-label={`Quitar ${t.label || "destino"}`}
                  >
                    <Trash2 size={16} /> <span className="sm:hidden">Quitar</span>
                  </button>
                )}
              </div>
              {t.label.trim() && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold tracking-wide text-white">
                  <CornerUpRight size={13} /> {forwardButtonLabel(t.label.trim())}
                  {t.phone.trim() && <span className="font-normal opacity-80">· {t.phone.trim().startsWith("+") ? t.phone.trim() : displayPhone(t.phone)}</span>}
                </p>
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost border border-slate-200" disabled={targets.length >= 8} onClick={() => setTargets([...targets, { label: "", phone: "" }])}>
              <Plus size={15} /> Añadir destino
            </button>
            <button type="button" className="btn-primary" disabled={busy === "targets"} onClick={() => void save("targets")}>
              {busy === "targets" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Guardar destinos
            </button>
            {note("targets")}
          </div>
        )}
      </div>

      {/* ---- Estados ---- */}
      <div className="space-y-3 border-t border-slate-100 pt-5">
        <div>
          <h3 className="text-sm font-semibold">Estados del lead</h3>
          <p className="text-xs text-slate-500">Las opciones del desplegable de cada chat (contactado, no contesta, interesado…).</p>
        </div>
        <div className="space-y-2">
          {statuses.map((st, i) => (
            <div key={st.id ?? `new-${i}`} className="flex items-center gap-2">
              <span className={clsx("h-3 w-3 shrink-0 rounded-full", toneOf(st.color).dot)} aria-hidden />
              <input
                className="input min-w-0 flex-1"
                value={st.label}
                maxLength={40}
                disabled={!isAdmin}
                aria-label={`Estado ${i + 1}`}
                onChange={(e) => setStatuses(statuses.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
              />
              <select
                className="h-10 w-[6.5rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 sm:w-32"
                value={st.color}
                disabled={!isAdmin}
                aria-label="Color"
                onChange={(e) => setStatuses(statuses.map((x, k) => (k === i ? { ...x, color: e.target.value } : x)))}
              >
                {LEAD_COLOR_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              {isAdmin && (
                <span className="flex shrink-0 items-center">
                  <button type="button" className="flex h-10 w-8 items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => moveStatus(i, -1)} aria-label="Subir">
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" className="flex h-10 w-8 items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === statuses.length - 1} onClick={() => moveStatus(i, 1)} aria-label="Bajar">
                    <ArrowDown size={15} />
                  </button>
                  <button type="button" className="flex h-10 w-8 items-center justify-center text-slate-400 hover:text-red-600" onClick={() => setStatuses(statuses.filter((_, k) => k !== i))} aria-label={`Quitar ${st.label}`}>
                    <Trash2 size={15} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost border border-slate-200" disabled={statuses.length >= 20} onClick={() => setStatuses([...statuses, { label: "", color: "slate" }])}>
              <Plus size={15} /> Añadir estado
            </button>
            <button type="button" className="btn-primary" disabled={busy === "statuses"} onClick={() => void save("statuses")}>
              {busy === "statuses" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Guardar estados
            </button>
            {note("statuses")}
          </div>
        )}
      </div>

      {/* ---- Make ---- */}
      {isAdmin && state.intakeUrl && (
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div>
            <h3 className="text-sm font-semibold">Entrada de leads desde Make</h3>
            <p className="text-xs text-slate-500">
              En cada escenario de Meta Lead Ads añade un módulo HTTP «Make a request» (POST, cuerpo JSON) con esta URL. En «linea» pon el
              teléfono o el nombre del número del CRM que debe llevar esos leads; ese número envía su «Primer mensaje a los leads»
              (Teléfonos → Avanzado).
            </p>
          </div>
          <div className="flex gap-2">
            <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={state.intakeUrl} onFocus={(e) => e.target.select()} aria-label="URL para Make" />
            <button
              type="button"
              className="btn-ghost shrink-0 border border-slate-200"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.intakeUrl!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {}
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />} <span className="hidden sm:inline">{copied ? "Copiada" : "Copiar"}</span>
            </button>
          </div>
          <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">Ejemplo de cuerpo JSON para Make</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre text-[11px] leading-5">{MAKE_EXAMPLE}</pre>
            <p className="mt-2">
              Opcional: «mensaje» para mandar un texto propio en lugar de la plantilla del número, o «enviar_mensaje»: false para que el lead
              entre sin mensaje. Si Make repite un lead con el mismo «lead_id», no se duplica.
            </p>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-ghost border border-slate-200 text-xs"
              disabled={busy === "token"}
              onClick={() => {
                if (confirm("La URL actual dejará de funcionar y habrá que cambiarla en todos los escenarios de Make. ¿Crear una nueva?")) void save("token");
              }}
            >
              {busy === "token" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Crear URL nueva
            </button>
            {note("token")}
          </div>
        </div>
      )}
    </section>
  );
}
