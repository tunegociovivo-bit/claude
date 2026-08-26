"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, FileText, Loader2, ShieldAlert, Trash2, Upload } from "lucide-react";

type Profile = Record<string, string>;
type StoredFile = { id: string; name: string; targetId: string | null; url: string | null; createdAt: string };

const FIELDS = [
  ["representativeName", "Nombre del representante", "text", true], ["representativeSurnames", "Apellidos", "text", true],
  ["representativeId", "DNI/NIE", "text", true], ["representativeRole", "Cargo / poderes", "text", true],
  ["representativeEmail", "Email de comunicaciones", "email", true], ["representativePhone", "Teléfono", "tel", true],
  ["companyTaxId", "NIF/CIF de la empresa", "text", true], ["legalName", "Razón social", "text", true],
  ["tradeName", "Nombre comercial", "text", false], ["legalForm", "Forma jurídica", "text", true],
  ["address", "Domicilio social/fiscal", "text", true], ["postalCode", "Código postal", "text", true],
  ["city", "Población", "text", true], ["province", "Provincia", "text", true], ["country", "País", "text", true],
  ["website", "Web", "url", false], ["cnae", "CNAE principal", "text", true], ["iae", "Epígrafe IAE", "text", false],
  ["foundingDate", "Fecha de constitución", "date", false], ["employeeCount", "Nº de empleados", "number", false],
  ["annualTurnover", "Facturación último ejercicio (€)", "number", false], ["deMinimisAmount", "Ayudas de minimis últimos 3 años (€)", "number", false]
] as const;

const DOCUMENTS = [
  ["company_tax_card", "Tarjeta NIF/CIF", "Obligatorio habitualmente"],
  ["representative_id", "DNI/NIE del representante", "Obligatorio habitualmente"],
  ["incorporation_deed", "Escritura de constitución y estatutos vigentes", "PDF completo e inscrito"],
  ["representation_powers", "Poderes de representación", "Nombramiento o poder notarial vigente"],
  ["tax_certificate", "Certificado de estar al corriente con Hacienda", "Renovar cuando caduque"],
  ["social_security_certificate", "Certificado de estar al corriente con Seguridad Social", "Renovar cuando caduque"],
  ["iae_cnae", "Alta IAE / certificado CNAE", "Situación censal o modelo 036/037"],
  ["bank_ownership", "Certificado de titularidad bancaria", "Sin claves ni movimientos bancarios"],
  ["annual_accounts", "Cuentas anuales / Impuesto de Sociedades", "Último ejercicio cerrado"],
  ["turnover_proof", "Modelos fiscales de facturación", "IVA/IRPF o documentación equivalente"],
  ["workforce", "Plantilla y cotización", "RNT/RLC o informe de plantilla, si se exige"],
  ["technical_solvence", "Solvencia técnica y certificados de buena ejecución", "Contratos, certificados y referencias similares"],
  ["portfolio", "Portfolio y casos de éxito", "Especialmente servicios comparables"],
  ["team_cvs", "CV y titulaciones del equipo", "Perfiles que se adscribirán al proyecto"],
  ["insurance", "Seguro de responsabilidad civil", "Póliza y recibo vigente"],
  ["equality_prevention", "Planes y políticas corporativas", "Igualdad, PRL, RGPD y medioambiente cuando apliquen"]
] as const;

export default function SubvencionApplicationVault() {
  const [open, setOpen] = useState(false); const [profile, setProfile] = useState<Profile>({ country: "España" });
  const [files, setFiles] = useState<StoredFile[]>([]); const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState<string | null>(null); const [message, setMessage] = useState("");
  async function load() { setLoading(true); const r = await fetch("/api/v1/admin/subvenciones/vault"); if (r.ok) { const j = await r.json(); setProfile({ country: "España", ...(j.profile ?? {}) }); setFiles(j.files ?? []); } setLoading(false); }
  useEffect(() => { void load(); }, []);
  const required = FIELDS.filter((x) => x[3]); const completedFields = required.filter(([key]) => profile[key]?.trim()).length;
  const completedDocs = DOCUMENTS.filter(([key]) => files.some((f) => f.targetId === key)).length;
  const percent = Math.round(((completedFields + completedDocs) / (required.length + DOCUMENTS.length)) * 100);
  const missing = useMemo(() => DOCUMENTS.filter(([key]) => !files.some((f) => f.targetId === key)), [files]);
  async function save() { setSaving(true); setMessage(""); const r = await fetch("/api/v1/admin/subvenciones/vault", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) }); setMessage(r.ok ? "Datos guardados. Se reutilizarán en los próximos expedientes." : "No se pudieron guardar los datos."); setSaving(false); }
  async function upload(category: string, selected: FileList | null) { if (!selected?.length) return; setUploading(category); setMessage(""); for (const file of Array.from(selected)) { const form = new FormData(); form.append("file", file); form.append("targetType", "SUBVENCION_VAULT"); form.append("targetId", category); const r = await fetch("/api/v1/files/upload", { method: "POST", body: form }); if (!r.ok) { const j = await r.json().catch(() => ({})); setMessage(j?.error?.message ?? `No se pudo subir ${file.name}`); break; } } await load(); setUploading(null); }
  async function remove(id: string) { if (!confirm("¿Eliminar este documento de la bóveda?")) return; const r = await fetch(`/api/v1/files/${id}`, { method: "DELETE" }); if (r.ok) setFiles((current) => current.filter((f) => f.id !== id)); }
  if (loading) return <div className="mt-4 rounded-xl border bg-white p-4 text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Cargando bóveda de solicitudes…</div>;
  return <section className="mt-4 rounded-xl border border-indigo-200 bg-white overflow-hidden">
    <button onClick={() => setOpen(!open)} className="w-full p-4 flex items-center justify-between gap-3 text-left">
      <span><strong className="block text-slate-900">Bóveda de solicitudes · datos y documentos reutilizables</strong><span className="text-xs text-slate-500">Completa una vez la información que suelen pedir subvenciones y licitaciones.</span></span>
      <span className="flex items-center gap-3"><span className="text-sm font-bold text-indigo-700">{percent}%</span>{open ? <ChevronUp /> : <ChevronDown />}</span>
    </button>
    <div className="h-1.5 bg-slate-100"><div className="h-full bg-indigo-600" style={{ width: `${percent}%` }} /></div>
    {open && <div className="p-4 space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex gap-2"><ShieldAlert className="h-4 w-4 shrink-0" /><span><strong>No subas certificados digitales, claves privadas, contraseñas, PIN ni códigos Cl@ve.</strong> La firma se realizará siempre contigo en el navegador. Sí puedes subir certificados administrativos en PDF.</span></div>
      <div><h3 className="font-semibold text-slate-900">1. Representante y empresa</h3><p className="text-xs text-slate-500 mb-3">Los campos marcados con * son los mínimos habituales para abrir una presentación.</p><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {FIELDS.map(([key, label, type, required]) => <label key={key} className="text-xs text-slate-600">{label}{required ? " *" : ""}<input type={type} value={profile[key] ?? ""} onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>)}
        {[['isSme','¿Es pyme?'],['isPhysicalPerson','¿Actúa como persona física?'],['taxUpToDate','¿Al corriente con Hacienda?'],['socialSecurityUpToDate','¿Al corriente con Seguridad Social?']].map(([key,label]) => <label key={key} className="text-xs text-slate-600">{label}<select value={profile[key] ?? ""} onChange={(e) => setProfile((p) => ({...p,[key]:e.target.value}))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"><option value="">— Selecciona —</option><option value="yes">Sí</option><option value="no">No</option></select></label>)}
      </div><label className="mt-3 block text-xs text-slate-600">Descripción breve de la empresa, servicios y experiencia<textarea value={profile.companyDescription ?? ""} onChange={(e) => setProfile((p) => ({...p,companyDescription:e.target.value}))} rows={4} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label><button onClick={save} disabled={saving} className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar datos"}</button></div>
      <div><h3 className="font-semibold text-slate-900">2. Documentación maestra</h3><p className="text-xs text-slate-500 mb-3">Puedes subir varios archivos por categoría. Se reutilizarán, pero se comprobará su vigencia antes de cada presentación.</p><div className="space-y-2">{DOCUMENTS.map(([key, label, hint]) => { const categoryFiles=files.filter((f)=>f.targetId===key); return <div key={key} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">{categoryFiles.length ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <FileText className="h-4 w-4 text-slate-400" />}{label}</p><p className="text-[11px] text-slate-500">{hint}</p>{categoryFiles.map((f)=><span key={f.id} className="mt-1 mr-2 inline-flex items-center gap-1 text-xs bg-slate-100 rounded px-2 py-1"><a href={f.url ?? '#'} target="_blank" rel="noreferrer" className="hover:underline max-w-[260px] truncate">{f.name}</a><button onClick={()=>remove(f.id)} title="Eliminar"><Trash2 className="h-3 w-3 text-rose-500" /></button></span>)}</div><label className="shrink-0 inline-flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-2 text-xs hover:bg-slate-50">{uploading===key?<Loader2 className="h-3 w-3 animate-spin"/>:<Upload className="h-3 w-3"/>}Adjuntar<input type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip" onChange={(e)=>void upload(key,e.target.files)} /></label></div>})}</div></div>
      <div className={`rounded-lg p-3 text-sm ${missing.length ? 'bg-rose-50 text-rose-900' : 'bg-emerald-50 text-emerald-900'}`}><strong>{missing.length ? `Faltan ${missing.length} categorías documentales` : 'Documentación maestra completa'}</strong>{missing.length>0&&<p className="mt-1 text-xs">{missing.map((x)=>x[1]).join(' · ')}</p>}</div>
      {message && <p className="text-sm text-slate-700">{message}</p>}
    </div>}
  </section>;
}
