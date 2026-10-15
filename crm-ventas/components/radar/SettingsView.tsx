"use client";

import { useState } from "react";
import clsx from "clsx";
import { Plus, X, Loader2, Check } from "lucide-react";
import { jsonFetch } from "@/components/inbox/ui";
import type { Overview, ConfigView } from "./types";

export default function SettingsView({ overview, reload }: { overview: Overview; reload: () => void }) {
  const { isAdmin, options } = overview;
  const [config, setConfig] = useState<ConfigView>(overview.config);
  const [timeDraft, setTimeDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const set = <K extends keyof ConfigView>(k: K, v: ConfigView[K]) => setConfig((p) => ({ ...p, [k]: v }));

  function addTime() {
    const t = timeDraft.trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(t)) { setNotice({ tone: "error", text: "La hora debe ser HH:MM (p. ej. 08:30)." }); return; }
    if (!config.times.includes(t)) set("times", [...config.times, t].sort());
    setTimeDraft("");
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    const { ok, data } = await jsonFetch<{ error?: string }>("/api/v1/radar/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
    setSaving(false);
    if (ok) { setNotice({ tone: "ok", text: "Guardado." }); reload(); }
    else setNotice({ tone: "error", text: data.error ?? "No se pudo guardar." });
  }

  const disabled = !isAdmin;

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {!isAdmin && <p className="text-sm text-slate-500">Solo un administrador puede cambiar los avisos.</p>}

      <section>
        <h3 className="text-sm font-semibold text-slate-900">¿A qué horas revisar?</h3>
        <p className="mt-0.5 text-xs text-slate-500">Hora de España. El radar revisa todos los portales a cada hora que pongas.</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {config.times.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700">
              {t}
              {!disabled && <button onClick={() => set("times", config.times.filter((x) => x !== t))} className="text-slate-400 hover:text-slate-700"><X size={13} /></button>}
            </span>
          ))}
          {!disabled && (
            <span className="inline-flex items-center gap-1">
              <input value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTime()} placeholder="08:00" className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-sm" />
              <button onClick={addTime} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><Plus size={16} /></button>
            </span>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900">¿Qué días?</h3>
        <div className="mt-2 flex gap-1.5">
          {options.days.map((d) => {
            const on = config.days.includes(d.id);
            return (
              <button key={d.id} disabled={disabled} onClick={() => set("days", on ? config.days.filter((x) => x !== d.id) : [...config.days, d.id])}
                className={clsx("flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold transition", on ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500", disabled && "opacity-60")}>
                {d.label}
              </button>
            );
          })}
        </div>
      </section>

      <ListField label="Teléfonos para avisar por WhatsApp" hint="Con prefijo si no es España (ej. +34 612…)" placeholder="+34 612 34 56 78"
        values={config.notifyPhones} draft={phoneDraft} setDraft={setPhoneDraft} disabled={disabled}
        onAdd={() => { const v = phoneDraft.trim(); if (v && !config.notifyPhones.includes(v)) set("notifyPhones", [...config.notifyPhones, v]); setPhoneDraft(""); }}
        onRemove={(v) => set("notifyPhones", config.notifyPhones.filter((x) => x !== v))} />

      <ListField label="Emails para avisar" placeholder="correo@empresa.com"
        values={config.notifyEmails} draft={emailDraft} setDraft={setEmailDraft} disabled={disabled}
        onAdd={() => { const v = emailDraft.trim().toLowerCase(); if (v && !config.notifyEmails.includes(v)) set("notifyEmails", [...config.notifyEmails, v]); setEmailDraft(""); }}
        onRemove={(v) => set("notifyEmails", config.notifyEmails.filter((x) => x !== v))} />

      {notice && <p className={clsx("text-sm", notice.tone === "ok" ? "text-emerald-600" : "text-rose-600")}>{notice.text}</p>}

      {!disabled && (
        <button onClick={() => void save()} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Guardar avisos
        </button>
      )}
    </div>
  );
}

function ListField({ label, hint, placeholder, values, draft, setDraft, onAdd, onRemove, disabled }: {
  label: string; hint?: string; placeholder: string; values: string[]; draft: string;
  setDraft: (v: string) => void; onAdd: () => void; onRemove: (v: string) => void; disabled: boolean;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-2 space-y-1.5">
        {values.map((v) => (
          <div key={v} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="truncate">{v}</span>
            {!disabled && <button onClick={() => onRemove(v)} className="text-slate-400 hover:text-rose-600"><X size={15} /></button>}
          </div>
        ))}
        {!disabled && (
          <div className="flex gap-1.5">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAdd())} placeholder={placeholder} className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm" />
            <button onClick={onAdd} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><Plus size={16} /></button>
          </div>
        )}
        {values.length === 0 && disabled && <p className="text-sm text-slate-400">Ninguno.</p>}
      </div>
    </section>
  );
}
