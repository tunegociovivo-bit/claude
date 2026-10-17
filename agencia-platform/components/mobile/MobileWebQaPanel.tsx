"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, FlaskConical, Save, Square, Trash2 } from "lucide-react";
import { validateWebQa, webQaSearchUrl, type WebQaTemplate, type WebQaReport } from "@/lib/mobile/web-qa";

const initial: WebQaTemplate = { name: "", keyword: "", business: "", urls: [], seconds: 120 };

export default function MobileWebQaPanel({ ready, storageScope, onOpenUrl, onStart, onStop, report, configurationOnly = false }: {
  ready: boolean;
  storageScope: string;
  onOpenUrl: (url: string) => Promise<void>;
  configurationOnly?: boolean;
  onStart?: (config: WebQaTemplate, id: string) => Promise<void>;
  onStop?: (id: string) => Promise<void>;
  report?: WebQaReport | null;
}) {
  const [form, setForm] = useState(initial);
  const [urls, setUrls] = useState("");
  const [templates, setTemplates] = useState<WebQaTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [searched, setSearched] = useState(false);
  const [manualClick, setManualClick] = useState(false);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const activeId = report?.status === "running" ? report.id : requestedId;
  const key = `nv-web-qa-templates-v1:${storageScope}`;
  const field = "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

  useEffect(() => {
    if (!requestedId) return;
    if (report?.id === requestedId) { setRequestedId(null); return; }
    const timer = setTimeout(() => { setRequestedId(null); setMessage("La estacion no ha confirmado el inicio. Comprueba que esta actualizada y abierta en modo diagnostico."); }, 45000);
    return () => clearTimeout(timer);
  }, [requestedId, report?.id]);

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
      {!configurationOnly && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />Tengo autorizacion para probar las URLs indicadas.</label>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={() => void action(() => {
          const next = config(); save([...templates.filter((t) => t.name !== next.name), next].slice(-30)); setMessage("Plantilla guardada.");
        })}><Save size={14} />Guardar plantilla</button>
        {!configurationOnly && <button type="button" disabled={busy || Boolean(activeId) || !ready || !authorized} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={() => void action(async () => {
          await onOpenUrl(webQaSearchUrl(config())); setSearched(true); setManualClick(false); setMessage("Busqueda abierta. Selecciona manualmente el resultado en el movil.");
        })}><ExternalLink size={14} />Abrir busqueda</button>}
      </div>
      {!configurationOnly && <><label className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={!searched} checked={manualClick} onChange={(e) => setManualClick(e.target.checked)} />He abierto manualmente el resultado del negocio.</label>
      <button type="button" disabled={busy || Boolean(activeId) || !ready || !authorized || !manualClick || !onStart} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => void action(async () => {
        const id = crypto.randomUUID(); await onStart!(config(), id); setRequestedId(id); setManualClick(false);
        setMessage("Inicio solicitado al Hub. El estado y el informe apareceran aqui; no necesitas instalar nada en la web.");
      })}><FlaskConical size={16} />Iniciar recorrido desde el Hub</button>
      <button type="button" disabled={busy || !activeId || !onStop} className="ml-2 inline-flex items-center gap-1 rounded border px-3 py-2 text-sm disabled:opacity-40" onClick={() => void action(async () => {
        await onStop!(activeId!); setMessage("Parada solicitada. No cierres la estacion hasta que el estado confirme la detencion.");
      })}><Square size={14} />Detener</button></>}
      <p className="text-xs text-slate-600">Control desde el Hub, sin script en la web. Visitas y desplazamientos entre URLs autorizadas; no pulsa enlaces, botones ni formularios. Sin mapa de calor integrado. La marca nv_test no excluye automaticamente estas visitas de otras analiticas.</p>
      {!configurationOnly && !ready && !activeId && <p className="text-xs text-amber-800">La estacion debe estar actualizada, con la pantalla abierta en modo de pruebas y sin trabajos pendientes. <a className="underline" href="/moviles?diagnostic=1">Abrir modo de pruebas en el ordenador USB</a></p>}
      {!configurationOnly && report && <div className="border-t pt-2 text-xs">
        <p role="status">Prueba {report.id.slice(0, 8)} · {({ running: "En curso", completed: "Completada", stopped: "Detenida", failed: "Error" })[report.status]} · {report.events.length} acciones</p>
        {report.error && <p role="alert" className="mt-1 text-rose-700">{report.error}</p>}
        <button type="button" className="mt-2 inline-flex items-center gap-1 rounded border px-2 py-1.5" onClick={() => {
          const blob = new Blob([JSON.stringify({ ...report, synthetic: true, engine: "hub-android", heatmap: "not-configured" }, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `nv-web-qa-${report.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}><Download size={14} />Descargar informe</button>
        <details className="mt-2"><summary>Ultimas acciones</summary><ol className="max-h-48 overflow-auto">{report.events.slice(-15).map((event, index) => <li className="break-words py-1" key={`${event.at}-${index}`}>{new Date(event.at).toLocaleTimeString()} · {event.action} {event.path} {event.detail}</li>)}</ol></details>
      </div>}
      {message && <p role="status" className="break-words text-xs text-slate-700">{message}</p>}
    </div>
  </details>;
}
