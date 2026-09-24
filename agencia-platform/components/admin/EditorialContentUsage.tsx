"use client";

import { useState } from "react";

export default function EditorialContentUsage({ post, onChanged }: {
  post: { id: string; status: string; publishedAt: string | null; metaJson?: any };
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const used = Boolean(post.metaJson?.contentUsage?.usedAt);
  const published = post.status === "PUBLISHED" || Boolean(post.publishedAt);
  const topics: string[] = Array.isArray(post.metaJson?.editorialGeneration?.coveredTopics) ? post.metaJson.editorialGeneration.coveredTopics : [];
  async function toggle() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/editorial/posts/${post.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ used: !used })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "No se pudo actualizar.");
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo actualizar."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-lg border bg-slate-50 p-3 space-y-2">
    {topics.length > 0 && <div className="flex flex-wrap items-center gap-1 text-xs"><span>Temas cubiertos:</span>{topics.map(t => <span key={t} className="rounded-full bg-violet-100 px-2 py-1 text-violet-900">{t}</span>)}</div>}
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={used || published} disabled={busy || published} onChange={toggle} />{published ? "Publicada · excluida de futuras generaciones" : "Contenido utilizado · evitar repetirlo"}</label>
    <p className="text-[11px] text-slate-500">Marcar como utilizado no publica en ninguna red. Para recuperarlo en un mes nuevo, activa expresamente la reutilización al generar.</p>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </section>;
}
