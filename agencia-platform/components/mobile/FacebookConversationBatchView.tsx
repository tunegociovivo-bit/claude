"use client";
import type { FacebookConversationBatch } from "@/lib/mobile/facebook-conversations";

export default function FacebookConversationBatchView({ batch, editable, disabled, onChange }: {
  batch: FacebookConversationBatch; editable: boolean; disabled: boolean; onChange: (batch: FacebookConversationBatch) => void;
}) {
  const pending = batch.candidates.filter((item) => ["pending", "failed"].includes(item.outcome));
  const selected = pending.filter((item) => item.selected).length;
  return <div className="mt-3 space-y-3">
    <p role="status" className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-900">{batch.progress}</p>
    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
      <span>{batch.groups.filter((group) => group.status === "done").length} grupos revisados</span>
      <span>· {batch.candidates.length} comentarios</span>
      <span>· {selected} respuestas seleccionadas</span>
    </div>
    <details className="rounded-lg border p-2 text-xs text-slate-600">
      <summary className="cursor-pointer font-semibold">Alcance y grupos revisados</summary>
      <p className="my-2">{batch.config.targetUrl || "Grupos de esta cuenta"} · Nicho: {batch.config.niche || "Todos"}. Hasta {batch.config.postsPerGroup} publicaciones y {batch.config.commentScreensPerPost} pantallas por publicación.</p>
      <p className="my-2">Palabra clave: {batch.config.searchTerm || "Todas"} · Buscar en: {batch.config.searchMode === "posts" ? "Publicaciones de mis grupos" : "Grupos por nombre o temática"}.</p>
      {batch.config.dateFrom && batch.config.dateTo ? <p className="my-2">Comentarios desde {batch.config.dateFrom} hasta {batch.config.dateTo}, ambos días incluidos.</p> : <p className="my-2">Comentarios de los últimos {batch.config.lookbackDays ?? 30} días{batch.config.referenceTime ? ` hasta ${new Date(batch.config.referenceTime).toLocaleString("es-ES")}` : ""}. Las fechas no legibles se excluyen.</p>}
      {batch.groups.map((group, index) => <p key={`${group.name}-${index}`} className="my-1"><strong>{group.name}</strong> · {({ pending: "Pendiente", done: "Revisado", excluded: "Fuera del nicho", failed: "Necesita revisión" })[group.status]}{group.detail ? `: ${group.detail}` : ""}</p>)}
      {batch.warnings.map((warning, index) => <p key={index} className="mt-2 text-amber-800">{warning}</p>)}
    </details>
    {editable && pending.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2 text-xs">
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={selected === pending.length} disabled={disabled} onChange={(event) => onChange({ ...batch, candidates: batch.candidates.map((item) => ["pending", "failed"].includes(item.outcome) ? { ...item, selected: event.target.checked } : item) })} /> Seleccionar todos</label>
      <button type="button" disabled={disabled} onClick={() => onChange({ ...batch, candidates: batch.candidates.map((item) => ({ ...item, selected: false })) })} className="text-slate-600 underline">Quitar selección</button>
    </div>}
    {!batch.candidates.length && batch.progress.startsWith("Búsqueda terminada") && <p className="rounded-lg border border-dashed p-4 text-xs text-slate-600">{batch.groups.some((group) => group.status === "failed") ? "La lectura quedó incompleta. Consulta los grupos que necesitan revisión antes de repetir la búsqueda." : "No se encontraron comentarios que cumplieran los criterios en las pantallas revisadas. Consulta el alcance para ver qué grupos se pudieron leer."}</p>}
    {batch.candidates.map((item) => <article key={item.id} className={`rounded-xl border p-3 ${item.selected ? "border-indigo-200 bg-indigo-50/30" : "bg-white"}`}>
      <div className="flex items-start gap-2">
        {editable && ["pending", "failed"].includes(item.outcome) && <input aria-label={`Seleccionar comentario de ${item.author} en ${item.groupName}`} type="checkbox" checked={item.selected} disabled={disabled} className="mt-1" onChange={(event) => onChange({ ...batch, candidates: batch.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, selected: event.target.checked } : candidate) })} />}
        <div><p className="text-xs font-bold text-indigo-900">{item.groupName}</p><p className="text-xs text-slate-600">{item.author}{item.dateLabel ? ` · ${item.dateLabel}` : ""}</p></div>
        {item.outcome !== "pending" && <span className="ml-auto text-xs font-semibold">{({ sending: "Por comprobar", sent: "Enviada", review: "Revisar en Facebook", failed: "No enviada" })[item.outcome]}</span>}
      </div>
      <blockquote className="my-3 whitespace-pre-wrap border-l-2 border-slate-300 pl-3 text-sm text-slate-700">{item.sourceText}</blockquote>
      <label className="block text-xs font-semibold text-slate-700">Respuesta propuesta
        <textarea aria-label={`Respuesta para ${item.author} en ${item.groupName}`} value={item.reply} rows={3} maxLength={2000} disabled={!editable || disabled || !["pending", "failed"].includes(item.outcome)} onChange={(event) => onChange({ ...batch, candidates: batch.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, reply: event.target.value } : candidate) })} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal disabled:bg-slate-50" />
      </label>
      {item.detail && <p className="mt-2 text-xs text-slate-600">{item.detail}</p>}
    </article>)}
  </div>;
}
