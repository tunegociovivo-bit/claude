"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Paperclip, Save, Trash2 } from "lucide-react";

const STAGES = [
  ["DETECTED", "Oportunidad detectada"], ["ELIGIBILITY", "Validando requisitos"], ["DOCUMENTS", "Recopilando documentación"],
  ["DRAFT", "Preparando memoria y oferta"], ["SIGNATURE", "Pendiente de firma/autorización"], ["SUBMISSION", "Lista para presentar"],
  ["SUBMITTED", "Presentada"], ["FOLLOWUP", "Seguimiento y subsanaciones"]
] as const;
type StoredFile = { id: string; name: string; url: string | null };

export default function SubvencionWorkflowPanel({ taskId, requisitos }: { taskId: string; requisitos: string }) {
  const [stage, setStage] = useState("ELIGIBILITY"); const [nextStep, setNextStep] = useState("");
  const [documentsText, setDocumentsText] = useState(""); const [blockers, setBlockers] = useState("");
  const [files, setFiles] = useState<StoredFile[]>([]); const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultDocuments = useMemo(() => [requisitos, "Declaraciones responsables y acreditación de capacidad para contratar", "Propuesta técnica / memoria", "Oferta económica y desglose presupuestario"].filter(Boolean), [requisitos]);
  async function load() {
    setLoading(true); const r = await fetch(`/api/v1/admin/subvenciones/workflow?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
    if (r.ok) { const d = await r.json(); setStage(d.workflow?.stage ?? "ELIGIBILITY"); setNextStep(d.workflow?.nextStep ?? ""); setDocumentsText((d.workflow?.requiredDocuments?.length ? d.workflow.requiredDocuments : defaultDocuments).join("\n")); setBlockers(d.workflow?.blockers ?? ""); setFiles(d.files ?? []); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  const stageIndex = Math.max(0, STAGES.findIndex(([value]) => value === stage));
  const percent = Math.round((stageIndex / (STAGES.length - 1)) * 100);
  async function save() {
    setSaving(true); setMessage(""); const requiredDocuments = documentsText.split("\n").map((x) => x.trim()).filter(Boolean);
    const r = await fetch("/api/v1/admin/subvenciones/workflow", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, stage, nextStep, requiredDocuments, blockers }) });
    setMessage(r.ok ? "Progreso guardado." : "No se pudo guardar el progreso."); setSaving(false);
  }
  async function upload(selected: FileList | null) {
    if (!selected?.length) return; setUploading(true); setMessage("");
    for (const file of Array.from(selected)) { const form = new FormData(); form.set("file", file); form.set("targetType", "SUBVENCION_APPLICATION"); form.set("targetId", taskId); const r = await fetch("/api/v1/files/upload", { method: "POST", body: form }); if (!r.ok) { setMessage(`No se pudo subir ${file.name}`); break; } }
    if (inputRef.current) inputRef.current.value = ""; await load(); setUploading(false);
  }
  async function remove(id: string) { if (!confirm("¿Eliminar este documento del expediente?")) return; const r = await fetch(`/api/v1/files/${id}`, { method: "DELETE" }); if (r.ok) setFiles((current) => current.filter((file) => file.id !== id)); }
  if (loading) return <div className="mt-3 rounded-lg border bg-white p-3 text-xs text-slate-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Cargando tramitación…</div>;
  return <div className="mt-3 rounded-lg border border-indigo-200 bg-white p-3 space-y-3">
    <div className="flex items-center justify-between gap-2"><strong className="text-sm text-indigo-950">Tramitación del expediente</strong><span className="text-xs font-bold text-indigo-700">{percent}%</span></div>
    <div className="h-1.5 rounded bg-slate-100"><div className="h-full rounded bg-indigo-600" style={{ width: `${percent}%` }} /></div>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-xs text-slate-600">Punto actual<select value={stage} onChange={(e) => setStage(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm">{STAGES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-xs text-slate-600">Qué se necesita para continuar<textarea value={nextStep} onChange={(e)=>setNextStep(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm" /></label>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-xs text-slate-600">Documentación necesaria <span className="text-slate-400">(un documento/requisito por línea)</span><textarea value={documentsText} onChange={(e)=>setDocumentsText(e.target.value)} rows={5} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm" /></label>
      <label className="text-xs text-slate-600">Bloqueos o intervención necesaria<textarea value={blockers} onChange={(e)=>setBlockers(e.target.value)} rows={5} placeholder="Ej.: falta certificado, firma digital o aclaración técnica." className="mt-1 w-full rounded-lg border px-2 py-2 text-sm" /></label>
    </div>
    <div className="rounded-lg border bg-slate-50 p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700">Documentos de esta solicitud</span><label className="inline-flex cursor-pointer items-center gap-1 rounded border bg-white px-2 py-1 text-xs"><Paperclip className="h-3 w-3" />{uploading ? "Subiendo…" : "Adjuntar"}<input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip" onChange={(e)=>void upload(e.target.files)} /></label></div>
      {files.length ? <div className="mt-2 flex flex-wrap gap-1.5">{files.map((file)=><span key={file.id} className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-xs"><CheckCircle2 className="h-3 w-3 text-emerald-600" /><a href={file.url ?? "#"} target="_blank" rel="noreferrer" className="max-w-[260px] truncate hover:underline">{file.name}</a><button onClick={()=>void remove(file.id)} title="Eliminar"><Trash2 className="h-3 w-3 text-rose-500" /></button></span>)}</div> : <p className="mt-2 flex items-center gap-1 text-xs text-slate-400"><FileText className="h-3 w-3" />Aún no hay documentos específicos adjuntos.</p>}
    </div>
    <div className="flex items-center gap-2"><button onClick={()=>void save()} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">{saving?<Loader2 className="h-3 w-3 animate-spin"/>:<Save className="h-3 w-3"/>}Guardar seguimiento</button>{message&&<span className="text-xs text-slate-600">{message}</span>}</div>
  </div>;
}
