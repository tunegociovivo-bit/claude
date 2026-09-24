"use client";
import { useState } from "react";

export default function EditorialResizePreview({ postId, imageUrl, onApplied }: { postId: string; imageUrl: string; onApplied: () => void }) {
  const [width, setWidth] = useState(1080), [height, setHeight] = useState(1080);
  const [fit, setFit] = useState("cover"), [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  function clear() { setPreview(""); setError(""); }
  async function resize(apply: boolean) {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/v1/editorial/posts/${postId}/media/resize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ width, height, fit, preview: !apply }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || data.message || "No se pudo adaptar la imagen");
      setPreview(data.url); if (apply) onApplied();
    } catch (e) { setError(e instanceof Error ? e.message : "Error al adaptar"); } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded border p-3">
    <h4 className="font-medium">Adaptar tamaño</h4>
    <select aria-label="Formato de imagen" className="w-full rounded border p-2" onChange={e => { const [w,h] = e.target.value.split("x").map(Number); if (w && h) { setWidth(w); setHeight(h); } clear(); }}>
      <option value="1080x1080">Post cuadrado · 1080 × 1080</option><option value="1080x1350">Post vertical · 1080 × 1350</option><option value="1080x1920">Story / Reel / portada · 1080 × 1920</option><option value="1200x630">Facebook · 1200 × 630</option><option value="custom">Personalizado</option>
    </select>
    <div className="flex gap-2"><label>Ancho <input className="w-24 rounded border p-1" type="number" min={100} max={4096} value={width} onChange={e => { setWidth(Number(e.target.value)); clear(); }} /></label><label>Alto <input className="w-24 rounded border p-1" type="number" min={100} max={4096} value={height} onChange={e => { setHeight(Number(e.target.value)); clear(); }} /></label></div>
    <select aria-label="Ajuste" className="rounded border p-2" value={fit} onChange={e => { setFit(e.target.value); clear(); }}><option value="cover">Recortar</option><option value="contain">Encajar con margen blanco</option><option value="fill">Rellenar con fondo difuminado</option></select>
    <img src={preview || imageUrl} alt={preview ? "Vista previa del tamaño" : "Imagen actual"} className="max-h-80 w-full object-contain" />
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex gap-2"><button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={() => resize(false)}>Previsualizar</button><button type="button" disabled={busy || !preview} className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-50" onClick={() => resize(true)}>Aplicar y guardar versión</button></div>
  </section>;
}
