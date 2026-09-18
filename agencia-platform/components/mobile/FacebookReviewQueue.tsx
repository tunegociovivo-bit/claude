"use client";

import { useEffect, useRef, useState } from "react";
import { addFacebookReviewLinks, facebookKeywordReviewItem, MAX_FACEBOOK_REVIEW_ITEMS, parseFacebookReviewQueue, type FacebookReviewItem } from "@/lib/mobile/facebook-review-queue";

export default function FacebookReviewQueue({ storageKey, ready, onOpen }: {
  storageKey: string; ready: boolean; onOpen: (url: string) => Promise<string | void>;
}) {
  const [items, setItems] = useState<FacebookReviewItem[]>([]);
  const [links, setLinks] = useState("");
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState(false);
  useEffect(() => {
    try { const saved = localStorage.getItem(storageKey); if (saved) setItems(parseFacebookReviewQueue(saved)); }
    catch { setMessage("No se pudo recuperar la cola guardada. Puedes volver a añadir los enlaces."); }
    setLoaded(true);
  }, [storageKey]);

  function save(next: FacebookReviewItem[]) {
    setItems(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setMessage("La cola funciona, pero no se ha podido guardar en este navegador."); }
  }
  function addLinks() {
    const result = addFacebookReviewLinks(items, links);
    setMessage(`${result.added} enlaces añadidos · ${result.duplicates} duplicados.${result.rejected.length ? ` Revisa las líneas ${result.rejected.join(", ")}: enlace no válido o límite de 100 destinos.` : ""}`);
    save(result.items);
    if (!result.rejected.length) setLinks("");
  }
  function addSearch() {
    try {
      const item = facebookKeywordReviewItem(keyword);
      if (items.some(existing => existing.url === item.url)) throw new Error("Esta búsqueda ya está en la cola.");
      if (items.length >= MAX_FACEBOOK_REVIEW_ITEMS) throw new Error("La cola admite hasta 100 destinos.");
      setMessage("Búsqueda añadida. Al abrirla verás los resultados en Facebook.");
      save([...items, item]); setKeyword("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo añadir la búsqueda."); }
  }
  async function open(item: FacebookReviewItem) {
    if (busyRef.current || !ready) return;
    busyRef.current = true; setBusy(true); setMessage("");
    try { const notice = await onOpen(item.url); setActive(item.url); if (notice) setMessage(notice); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo abrir el destino."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function next() {
    const updated = items.map(item => item.url === active ? { ...item, reviewed: true } : item);
    save(updated); setActive(null);
    const pending = updated.find(item => !item.reviewed);
    if (pending) await open(pending); else setMessage("Has terminado de revisar la cola.");
  }
  const pending = items.filter(item => !item.reviewed);
  const current = items.find(item => item.url === active);
  return <section className="space-y-3 rounded-xl border border-blue-200 bg-white p-3" aria-label="Cola de revisión de Facebook">
    <p className="text-xs leading-5 text-slate-600">Reúne enlaces de publicaciones y anuncios o añade búsquedas por temática. Abre cada destino en el móvil y decide allí si quieres dar «Me gusta». Marcar como revisado solo organiza esta cola.</p>
    <label className="block text-xs font-semibold">Enlaces de publicaciones o anuncios, uno por línea
      <textarea value={links} onChange={e => setLinks(e.target.value)} rows={4} maxLength={100000} placeholder="https://www.facebook.com/…" className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" />
    </label>
    <button type="button" disabled={!loaded || busy || !links.trim()} onClick={addLinks} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Añadir enlaces a la cola</button>
    <label className="block text-xs font-semibold">Palabra clave
      <input value={keyword} onChange={e => setKeyword(e.target.value)} maxLength={200} placeholder="Ej. franquicias" className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" />
    </label>
    <button type="button" disabled={!loaded || busy || !keyword.trim()} onClick={addSearch} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Añadir búsqueda de publicaciones</button>
    <p className="text-xs text-slate-500">Las búsquedas abren los resultados de Facebook; no importan automáticamente sus publicaciones. Cola guardada para este móvil en este navegador.</p>
    <div className="border-t pt-3">
      <p className="text-sm font-bold">{pending.length} pendientes · {items.length - pending.length} revisados</p>
      {!ready && <p className="mt-1 text-xs text-amber-800">Abre la pantalla y espera a que terminen los encargos del móvil para revisar la cola.</p>}
      {current && <p className="mt-2 break-all text-xs">Abierto para revisar: {current.label}</p>}
      <button type="button" disabled={!ready || busy || !pending.length} onClick={() => { if (current) void next(); else if (pending[0]) void open(pending[0]); }} className="mt-2 w-full rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Abriendo…" : current ? "Marcar revisado y abrir siguiente" : "Abrir siguiente pendiente"}</button>
      <label className="mt-3 flex gap-2 text-xs"><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} />Mostrar revisados</label>
      <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">{items.filter(item => history || !item.reviewed).map(item => <li key={item.url} className="rounded-lg border p-2 text-xs">
        <p className="font-semibold">{item.kind === "search" ? "Búsqueda" : "Publicación o anuncio"} · {item.reviewed ? "Revisado" : "Pendiente"}</p>
        <p className="my-1 break-all text-slate-600">{item.label}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!ready || busy} onClick={() => void open(item)} className="rounded border px-2 py-1 disabled:opacity-50">Abrir en móvil</button>
          <button type="button" disabled={busy} onClick={() => { save(items.map(row => row.url === item.url ? { ...row, reviewed: !row.reviewed } : row)); if (active === item.url) setActive(null); }} className="rounded border px-2 py-1">{item.reviewed ? "Dejar pendiente" : "Marcar revisado"}</button>
          <button type="button" disabled={busy} onClick={() => { save(items.filter(row => row.url !== item.url)); if (active === item.url) setActive(null); }} className="rounded border px-2 py-1">Quitar de la cola</button>
        </div>
      </li>)}</ul>
    </div>
    {message && <p role="status" className="rounded-lg bg-blue-50 p-2 text-xs text-blue-900">{message}</p>}
  </section>;
}
