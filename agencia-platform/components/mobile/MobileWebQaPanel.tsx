"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink, FlaskConical, Save, Trash2 } from "lucide-react";
import { validateWebQa, webQaLaunchUrl, webQaSearchUrl, type WebQaTemplate } from "@/lib/mobile/web-qa";

const initial: WebQaTemplate = { name: "", keyword: "", business: "", urls: [], seconds: 120 };

export default function MobileWebQaPanel({ ready, storageScope, onOpenUrl, configurationOnly = false }: {
  ready: boolean;
  storageScope: string;
  onOpenUrl: (url: string) => Promise<void>;
  configurationOnly?: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [urls, setUrls] = useState("");
  const [templates, setTemplates] = useState<WebQaTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [searched, setSearched] = useState(false);
  const [manualClick, setManualClick] = useState(false);
  const key = `nv-web-qa-templates-v1:${storageScope}`;
  const field = "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

  useEffect(() => {
    const load = () => {
      setTemplates([]);
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(saved)) setTemplates(saved.slice(0, 30).flatMap((item) => {
          try { return [validateWebQa(item)]; } catch { return []; }
        }));
      } catch { /* Corrupt local preferences must not prevent device control. */ }
    };
    load();
    window.addEventListener("storage", load);
    window.addEventListener("nv-web-qa-templates", load);
    return () => { window.removeEventListener("storage", load); window.removeEventListener("nv-web-qa-templates", load); };
  }, [key]);

  function config() { return validateWebQa({ ...form, urls: urls.split(/\r?\n/).map((u) => u.trim()).filter(Boolean) }); }
  function update(patch: Partial<WebQaTemplate>) {
    setForm((old) => ({ ...old, ...patch })); setSearched(false); setManualClick(false); setMessage("");
  }
  async function action(run: () => Promise<void> | void) {
    setBusy(true); setMessage("");
    try { await run(); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo preparar la prueba."); }
    finally { setBusy(false); }
  }
  function save(items: WebQaTemplate[]) {
    localStorage.setItem(key, JSON.stringify(items)); setTemplates(items);
    window.dispatchEvent(new Event("nv-web-qa-templates"));
  }

  return <details className="border-y border-slate-200 bg-white">
    <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-800">{configurationOnly ? "Pruebas web · plantillas" : "Pruebas web asistidas"}</summary>
    <div className="space-y-3 px-3 pb-4">
      <div className="flex gap-2">
        <select aria-label="Plantilla de prueba web" className={field} value="" onChange={(e) => {
          const next = templates.find((item) => item.name === e.target.value);
          if (next) { update(next); setUrls(next.urls.join("\n")); setAuthorized(false); }
        }}><option value="">Plantillas guardadas en este navegador</option>{templates.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select>
        <button type="button" title="Eliminar plantilla con este nombre" aria-label="Eliminar plantilla" disabled={busy || !templates.some((item) => item.name === form.name)} className="shrink-0 rounded border p-2 disabled:opacity-40" onClick={() => void action(() => save(templates.filter((item) => item.name !== form.name)))}><Trash2 size={16} /></button>
      </div>
      <label className="block text-xs">Nombre de plantilla<input className={field} maxLength={120} value={form.name} onChange={(e) => update({ name: e.target.value })} /></label>
      <label className="block text-xs">Palabra clave<input className={field} maxLength={200} value={form.keyword} onChange={(e) => update({ keyword: e.target.value })} /></label>
      <label className="block text-xs">Negocio<input className={field} maxLength={120} value={form.business} onChange={(e) => update({ business: e.target.value })} /></label>
      <label className="block text-xs">URLs permitidas de una misma web · primera URL de entrada<textarea className={field} rows={4} maxLength={40000} placeholder={"https://tu-web.es/\nhttps://tu-web.es/servicios/"} value={urls} onChange={(e) => { setUrls(e.target.value); setAuthorized(false); setSearched(false); setManualClick(false); }} /></label>
      <label className="block text-xs">Duracion (segundos)<input className={field} type="number" min={30} max={900} step={1} value={form.seconds} onChange={(e) => update({ seconds: Number(e.target.value) })} /></label>
      {!configurationOnly && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />Tengo autorizacion para probar esta web y he instalado el script de pruebas.</label>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={() => void action(() => {
          const next = config(); save([...templates.filter((t) => t.name !== next.name), next].slice(-30)); setMessage("Plantilla guardada.");
        })}><Save size={14} />Guardar plantilla</button>
        {!configurationOnly && <button type="button" disabled={busy || !ready || !authorized} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={() => void action(async () => {
          await onOpenUrl(webQaSearchUrl(config())); setSearched(true); setManualClick(false); setMessage("Busqueda abierta. Selecciona manualmente el resultado en el movil.");
        })}><ExternalLink size={14} />Abrir busqueda</button>}
      </div>
      {!configurationOnly && <><label className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={!searched} checked={manualClick} onChange={(e) => setManualClick(e.target.checked)} />He abierto manualmente el resultado del negocio.</label>
      <button type="button" disabled={busy || !ready || !authorized || !manualClick} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => void action(async () => {
        const id = crypto.randomUUID(); await onOpenUrl(webQaLaunchUrl(config(), id)); setManualClick(false);
        setMessage(`Prueba ${id} preparada. Confirma el inicio en la web del movil. El informe y la parada estan en esa pantalla.`);
      })}><FlaskConical size={16} />Preparar recorrido de prueba</button></>}
      <details className="text-xs"><summary className="cursor-pointer py-1">Instalacion en cada web</summary>
        <p className="my-2">La preparacion abre de nuevo la URL de entrada con una marca de prueba. No conserva ni mide el recorrido previo de Google. Sin mapa de calor conectado; las marcas no excluyen automaticamente el trafico de otras analiticas.</p>
        <button type="button" className="inline-flex items-center gap-1 rounded border px-2 py-1.5" onClick={() => void action(async () => {
          await navigator.clipboard.writeText(`<script defer src="${window.location.origin}/nv-web-qa.js"></script>`); setMessage("Script de instalacion copiado.");
        })}><Copy size={14} />Copiar script de instalacion</button>
      </details>
      {!configurationOnly && !ready && <p className="text-xs text-amber-800">Abre la pantalla del movil y desactiva su trabajador automatico para preparar una prueba.</p>}
      {message && <p role="status" className="break-words text-xs text-slate-700">{message}</p>}
    </div>
  </details>;
}
