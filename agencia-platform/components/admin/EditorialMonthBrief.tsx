"use client";

import { useRef, useState } from "react";

export type MonthBrief = {
  referenceLinks: string[];
  extraReferenceUrls: string[];
  requiredTopics: string[];
  allowReuseUsed: boolean;
};

export const emptyMonthBrief: MonthBrief = {
  referenceLinks: [], extraReferenceUrls: [], requiredTopics: [], allowReuseUsed: false
};

export default function EditorialMonthBrief({ clientId, value, onChange, onBusyChange }: {
  clientId: string;
  value: MonthBrief;
  onChange: (value: MonthBrief) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [link, setLink] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(value);
  current.current = value;
  const inputClass = "rounded-lg border px-3 py-2 text-sm w-full";

  function addLink() {
    try {
      const url = new URL(link.trim());
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      if (value.referenceLinks.length >= 8) throw new Error("Puedes añadir hasta 8 enlaces.");
      onChange({ ...value, referenceLinks: [...new Set([...value.referenceLinks, url.href])] });
      setLink(""); setError("");
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "Introduce un enlace válido con https://."); }
  }

  async function upload(files: FileList | null) {
    if (!files?.length || !clientId || busy) return;
    if (value.extraReferenceUrls.length + files.length > 8) { setError("Puedes añadir hasta 8 imágenes."); return; }
    setBusy(true); onBusyChange(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const body = new FormData(); body.append("clientId", clientId); body.append("file", file);
        const response = await fetch("/api/v1/editorial/references/upload", { method: "POST", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error?.message ?? "No se pudo subir la referencia.");
        const next = { ...current.current, extraReferenceUrls: [...current.current.extraReferenceUrls, result.url] };
        current.current = next;
        onChange(next);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error subiendo las referencias."); }
    finally { setBusy(false); onBusyChange(false); }
  }

  return <section className="rounded-lg border border-violet-200 bg-violet-50/30 p-3 space-y-3">
    <h3 className="text-sm font-semibold">Referencias y temas de este mes</h3>
    <p className="text-xs text-slate-600">La IA consultará estos enlaces e imágenes al preparar el calendario. Describe en las instrucciones cómo quieres utilizarlos.</p>
    <div className="flex gap-2">
      <input aria-label="Enlace de referencia" value={link} onChange={e => setLink(e.target.value)} placeholder="https://lamarisca.com/menu/" className={inputClass} />
      <button type="button" disabled={busy || !link.trim()} onClick={addLink} className="rounded border px-3 text-xs disabled:opacity-50">Añadir enlace</button>
    </div>
    {value.referenceLinks.map(url => <div key={url} className="flex items-center gap-2 text-xs">
      <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-violet-700 underline">{url}</a>
      <button type="button" disabled={busy} aria-label={`Eliminar ${url}`} onClick={() => onChange({ ...value, referenceLinks: value.referenceLinks.filter(x => x !== url) })}>Eliminar</button>
    </div>)}
    <label className="block text-xs font-medium">Añadir imágenes de referencia
      <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy || !clientId} className="block mt-1 text-xs" onChange={e => { void upload(e.target.files); e.target.value = ""; }} />
    </label>
    {busy && <p role="status" className="text-xs">Subiendo referencias…</p>}
    <div className="flex flex-wrap gap-2">{value.extraReferenceUrls.map((url, i) => <div key={url} className="rounded border bg-white p-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Referencia ${i + 1}`} className="h-20 w-24 object-contain" />
      <button type="button" disabled={busy} className="w-full text-xs text-rose-700" onClick={() => onChange({ ...value, extraReferenceUrls: value.extraReferenceUrls.filter(x => x !== url) })}>Eliminar</button>
    </div>)}</div>
    <label className="block text-xs font-medium" htmlFor="monthly-required-topic">Temas obligatorios</label>
    <div className="flex gap-2">
      <input id="monthly-required-topic" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Aumento de pecho, rinoplastia, bótox" className={inputClass} />
      <button type="button" className="rounded border px-3 text-xs" disabled={!topic.trim() || busy} onClick={() => {
        const topics = [...new Set([...value.requiredTopics, ...topic.split(/[,\n]/).map(t => t.trim()).filter(Boolean)])];
        if (topics.length > 20) { setError("Puedes añadir hasta 20 temas."); return; }
        onChange({ ...value, requiredTopics: topics }); setTopic("");
      }}>Añadir temas</button>
    </div>
    <div className="flex flex-wrap gap-2">{value.requiredTopics.map(t => <span key={t} className="rounded-full border bg-white px-2 py-1 text-xs">{t} <button type="button" disabled={busy} aria-label={`Quitar tema ${t}`} onClick={() => onChange({ ...value, requiredTopics: value.requiredTopics.filter(x => x !== t) })}>×</button></span>)}</div>
    <p className="text-xs text-slate-500">Los temas se repartirán durante el mes y cada publicación mostrará cuáles cubre.</p>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value.allowReuseUsed} disabled={busy} onChange={e => onChange({ ...value, allowReuseUsed: e.target.checked })} />Permitir reutilizar contenido ya utilizado o publicado</label>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </section>;
}
