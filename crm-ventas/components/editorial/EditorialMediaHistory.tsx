"use client";
import { useEffect, useState } from "react";

type Version = { id: string; kind: string; source: string; url: string; prompt: string | null; createdAt: string; selected: boolean };
export default function EditorialMediaHistory({ postId, onApplied }: { postId: string; onApplied: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/editorial/posts/${postId}/media/versions`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error("No se pudo cargar el historial"); return r.json(); })
      .then(data => setVersions(data.versions)).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [postId]);
  async function choose(id: string) {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/v1/editorial/posts/${postId}/media/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: id }) });
      if (!r.ok) throw new Error("No se pudo restaurar la versión");
      setVersions(v => v.map(item => ({ ...item, selected: item.id === id })));
      onApplied();
    } catch (e) { setError(e instanceof Error ? e.message : "Error al restaurar"); } finally { setBusy(false); }
  }
  const labels: Record<string, string> = { uploaded: "Original subido", generated: "Generada", edited: "Editada", resized: "Adaptada", video: "Vídeo" };
  return <section className="space-y-3 rounded border p-3">
    <h4 className="font-medium">Historial de imágenes y vídeos</h4>
    <p className="text-xs text-slate-500">Selecciona dos imágenes para compararlas. Puedes recuperar cualquier versión sin eliminar las demás.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {!versions.length && !error && <p className="text-sm">Todavía no hay versiones guardadas.</p>}
    <div className="flex gap-3 overflow-x-auto">{versions.map(v => <div key={v.id} className="w-36 shrink-0 space-y-1">
      {v.kind === "video" ? <video src={v.url} controls className="h-28 w-full object-contain" /> : <img src={v.url} alt={labels[v.source] ?? v.source} className="h-28 w-full object-contain" />}
      <p className="text-xs">{labels[v.source] ?? v.source} · {new Date(v.createdAt).toLocaleDateString("es")}</p>
      {v.kind === "image" && <label className="block text-xs"><input type="checkbox" checked={compare.includes(v.id)} onChange={() => setCompare(ids => ids.includes(v.id) ? ids.filter(id => id !== v.id) : [...ids.slice(-1), v.id])} /> Comparar</label>}
      <button type="button" disabled={busy || v.selected} className="rounded border px-2 py-1 text-xs disabled:opacity-50" onClick={() => choose(v.id)}>{v.selected ? "Actual" : "Usar esta versión"}</button>
    </div>)}</div>
    {compare.length > 0 && <div className="grid grid-cols-2 gap-3">{compare.map(id => { const v = versions.find(item => item.id === id); return v ? <img key={id} src={v.url} alt="Versión para comparar" className="max-h-96 w-full object-contain" /> : null; })}</div>}
  </section>;
}
