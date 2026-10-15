"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Loader2, X } from "lucide-react";
import { jsonFetch } from "@/components/inbox/ui";
import type { Criteria, Overview, SearchView } from "./types";

const EMPTY: Criteria = {
  makes: [], models: [], keywords: [], excludeKeywords: [],
  yearMin: null, yearMax: null, kmMin: null, kmMax: null, priceMin: null, priceMax: null, powerMinCv: null,
  fuels: [], gearboxes: [], countries: [], portals: [], includeUnknown: false,
};

export default function SearchEditor({ overview, search, onClose, onSaved }: {
  overview: Overview;
  search: SearchView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(search?.name ?? "");
  const [c, setC] = useState<Criteria>(search ? { ...EMPTY, ...search.criteria } : EMPTY);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(search?.notifyWhatsapp ?? true);
  const [notifyEmail, setNotifyEmail] = useState(search?.notifyEmail ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [matched, setMatched] = useState<number | null>(null);

  const set = <K extends keyof Criteria>(key: K, value: Criteria[K]) => setC((prev) => ({ ...prev, [key]: value }));
  const num = (v: string): number | null => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v.replace(/[^\d]/g, "")))) || null);

  function toggleIn(key: "fuels" | "gearboxes" | "countries" | "portals", id: string) {
    const list = c[key];
    set(key, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function save() {
    setError("");
    if (!name.trim()) { setError("Ponle un nombre a la búsqueda."); return; }
    setSaving(true);
    const body = JSON.stringify({ name, criteria: c, notifyWhatsapp, notifyEmail });
    const { ok, data } = search
      ? await jsonFetch<{ error?: string }>(`/api/v1/radar/searches/${search.id}`, { method: "PUT", body })
      : await jsonFetch<{ error?: string; matched?: number }>("/api/v1/radar/searches", { method: "POST", body });
    setSaving(false);
    if (!ok) { setError(data.error ?? "No se pudo guardar."); return; }
    if (!search && typeof (data as any).matched === "number") {
      setMatched((data as any).matched);
      setTimeout(onSaved, 1200);
      return;
    }
    onSaved();
  }

  return (
    <div>
      <button onClick={onClose} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={16} /> Volver
      </button>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Field label="Nombre de la búsqueda">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. BMW Serie 1 diésel barato" className="input" />
        </Field>

        <ChipField label="Marcas" hint="Deja vacío para cualquier marca" values={c.makes} onChange={(v) => set("makes", v)} placeholder="BMW, Audi…" />
        <ChipField label="Modelos" hint="Palabras del modelo (Serie 1, Golf, X1…)" values={c.models} onChange={(v) => set("models", v)} placeholder="Serie 1, Golf…" />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Año desde"><input inputMode="numeric" value={c.yearMin ?? ""} onChange={(e) => set("yearMin", num(e.target.value))} placeholder="2018" className="input" /></Field>
          <Field label="Año hasta"><input inputMode="numeric" value={c.yearMax ?? ""} onChange={(e) => set("yearMax", num(e.target.value))} placeholder="2024" className="input" /></Field>
          <Field label="Km máximos"><input inputMode="numeric" value={c.kmMax ?? ""} onChange={(e) => set("kmMax", num(e.target.value))} placeholder="120000" className="input" /></Field>
          <Field label="Km mínimos"><input inputMode="numeric" value={c.kmMin ?? ""} onChange={(e) => set("kmMin", num(e.target.value))} placeholder="" className="input" /></Field>
          <Field label="Precio mínimo (€)"><input inputMode="numeric" value={c.priceMin ?? ""} onChange={(e) => set("priceMin", num(e.target.value))} placeholder="" className="input" /></Field>
          <Field label="Precio máximo (€)"><input inputMode="numeric" value={c.priceMax ?? ""} onChange={(e) => set("priceMax", num(e.target.value))} placeholder="15000" className="input" /></Field>
          <Field label="Potencia mínima (CV)"><input inputMode="numeric" value={c.powerMinCv ?? ""} onChange={(e) => set("powerMinCv", num(e.target.value))} placeholder="" className="input" /></Field>
        </div>

        <MultiField label="Combustible" options={overview.options.fuels} selected={c.fuels} onToggle={(id) => toggleIn("fuels", id)} />
        <MultiField label="Cambio" options={overview.options.gearboxes} selected={c.gearboxes} onToggle={(id) => toggleIn("gearboxes", id)} />
        <MultiField label="Países" options={overview.options.countries} selected={c.countries} onToggle={(id) => toggleIn("countries", id)} />
        <MultiField
          label="Portales (vacío = todos)"
          options={overview.sources.map((s) => ({ id: s.portal, label: s.name }))}
          selected={c.portals}
          onToggle={(id) => toggleIn("portals", id)}
        />

        <ChipField label="Palabras obligatorias" hint="El anuncio debe contenerlas" values={c.keywords} onChange={(v) => set("keywords", v)} placeholder="4x4, automático…" />
        <ChipField label="Palabras excluidas" hint="Descarta si aparecen" values={c.excludeKeywords} onChange={(v) => set("excludeKeywords", v)} placeholder="accidentado, taxi…" />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={c.includeUnknown} onChange={(e) => set("includeUnknown", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Avisar también si falta algún dato (p. ej. coches sin km indicado)
        </label>

        <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={notifyWhatsapp} onChange={(e) => setNotifyWhatsapp(e.target.checked)} className="h-4 w-4 rounded border-slate-300" /> Avisar por WhatsApp
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="h-4 w-4 rounded border-slate-300" /> Avisar por email
          </label>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {matched !== null && <p className="text-sm text-emerald-600">Guardada. Ahora mismo coinciden {matched} coche(s) del stock ya visto.</p>}

        <div className="flex gap-2">
          <button onClick={() => void save()} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {saving && <Loader2 size={16} className="animate-spin" />} Guardar
          </button>
          <button onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
        </div>
      </div>

      <style jsx>{`
        .input { width: 100%; height: 2.5rem; border-radius: 0.6rem; border: 1px solid rgb(226 232 240); padding: 0 0.7rem; font-size: 0.875rem; color: rgb(15 23 42); }
        .input:focus { outline: 2px solid rgb(143 185 255); outline-offset: -1px; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function MultiField({ label, options, selected, onToggle }: { label: string; options: Array<{ id: string; label: string }>; selected: string[]; onToggle: (id: string) => void }) {
  if (options.length === 0) return null;
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onToggle(o.id)}
            className={clsx("rounded-full border px-3 py-1 text-xs font-medium transition", selected.includes(o.id) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChipField({ label, hint, values, onChange, placeholder }: { label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  function commit(raw: string) {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, 40));
    setDraft("");
  }
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}{hint && <span className="ml-1 font-normal text-slate-400">· {hint}</span>}</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 p-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="text-slate-400 hover:text-slate-700"><X size={12} /></button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(draft); } }}
          onBlur={() => commit(draft)}
          placeholder={values.length ? "" : placeholder}
          className="min-w-[80px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
      </div>
    </div>
  );
}
