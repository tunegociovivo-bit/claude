"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Play, Square, ShieldCheck, UsersRound, Activity, BriefcaseBusiness } from "lucide-react";

type Member = { id: string; name: string; email: string; active: boolean; seconds: number; productive: number; tracked: number; idle: number };
type Dashboard = { days: number; isAdmin: boolean; members: Member[]; projects: { id: string; name: string }[]; topUsage: { name: string; seconds: number }[]; myActiveSession: { startedAt: string; projectId?: string | null; isPrivate: boolean } | null };
type Shot = { id: string; user: string; capturedAt: string; appName?: string | null; blurred: boolean; expiresAt: string; url: string };

const hours = (seconds: number) => `${(seconds / 3600).toFixed(1)} h`;

export default function TimeTrackingClient() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [days, setDays] = useState(7);
  const [projectId, setProjectId] = useState("");
  const [privateMode, setPrivateMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [enrollUser, setEnrollUser] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/time-tracking?days=${days}`, { cache: "no-store" });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message || "No se pudo cargar el control horario");
    setData(await r.json());
    const sr = await fetch("/api/v1/time-tracking/screenshots", { cache: "no-store" });
    if (sr.ok) setShots((await sr.json()).items ?? []);
  }, [days]);
  useEffect(() => { load().catch((e) => setError(e.message)); const id = setInterval(() => load().catch(() => {}), 60000); return () => clearInterval(id); }, [load]);
  const totals = useMemo(() => (data?.members ?? []).reduce((a, m) => ({ seconds: a.seconds + m.seconds, active: a.active + (m.active ? 1 : 0) }), { seconds: 0, active: 0 }), [data]);
  async function clock(action: "start" | "stop") {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/v1/time-tracking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "start" ? { action, projectId: projectId || null, privateMode } : { action }) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message || "No se pudo registrar el fichaje");
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function createEnrollment() {
    if (!enrollUser) return;
    setBusy(true); setError(""); setEnrollmentToken("");
    try {
      const r = await fetch("/api/v1/time-tracking/enrollment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: enrollUser }) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message || "No se pudo generar la credencial");
      setEnrollmentToken((await r.json()).token);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  if (!data) return <main className="p-6"><p>{error || "Cargando control horario…"}</p></main>;
  return <main className="mx-auto max-w-7xl space-y-6 p-5 md:p-8">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-indigo-600"><Clock3 size={18}/> CONTROL HORARIO</div><h1 className="text-3xl font-bold text-slate-900">Tiempo, equipo y productividad</h1><p className="mt-1 text-slate-600">Alternativa integrada a DeskTime, conectada con tus usuarios y proyectos.</p></div>
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-xl border border-slate-200 bg-white px-4 py-2"><option value={1}>Hoy</option><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select>
    </header>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi icon={<UsersRound/>} label="Trabajando ahora" value={`${totals.active}/${data.members.length}`}/><Kpi icon={<Clock3/>} label="Horas registradas" value={hours(totals.seconds)}/><Kpi icon={<Activity/>} label="Actividad medida" value={hours(data.members.reduce((a,m)=>a+m.tracked,0))}/><Kpi icon={<BriefcaseBusiness/>} label="Proyectos disponibles" value={String(data.projects.length)}/>
    </section>
    <section className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-white p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-end"><div className="flex-1"><h2 className="font-bold text-slate-900">Mi jornada</h2><p className="text-sm text-slate-600">El modo privado registra tiempo, pero oculta aplicación, dominio y título.</p></div>
      {!data.myActiveSession ? <><select value={projectId} onChange={(e)=>setProjectId(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2"><option value="">Sin proyecto</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={privateMode} onChange={(e)=>setPrivateMode(e.target.checked)}/> Modo privado</label><button disabled={busy} onClick={()=>clock("start")} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white"><Play size={17}/> Iniciar</button></> : <button disabled={busy} onClick={()=>clock("stop")} className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 font-semibold text-white"><Square size={17}/> Finalizar jornada</button>}</div>
      {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
    </section>
    <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b p-5"><h2 className="font-bold">Equipo</h2></div><div className="divide-y">{data.members.map(m=>{const pct=m.tracked ? Math.round(m.productive/m.tracked*100):0; return <div key={m.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 p-4"><div><div className="flex items-center gap-2 font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${m.active?"bg-emerald-500":"bg-slate-300"}`}/>{m.name}</div><div className="mt-1 text-xs text-slate-500">{m.email}</div></div><div className="text-right"><div className="font-bold">{hours(m.seconds)}</div><div className="text-xs text-slate-500">registradas</div></div><div className="w-20 text-right"><div className="font-bold text-indigo-600">{pct}%</div><div className="text-xs text-slate-500">productivo</div></div></div>})}</div></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Aplicaciones y webs principales</h2><div className="mt-4 space-y-3">{data.topUsage.length ? data.topUsage.map((u,i)=><div key={u.name}><div className="flex justify-between text-sm"><span className="truncate">{u.name}</span><b>{hours(u.seconds)}</b></div><div className="mt-1 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-indigo-500" style={{width:`${Math.max(4,u.seconds/data.topUsage[0].seconds*100)}%`}}/></div></div>) : <p className="text-sm text-slate-500">Instala el agente de escritorio para ver actividad automática.</p>}</div></div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-end justify-between gap-3"><div><h2 className="font-bold">Capturas periódicas</h2><p className="text-sm text-slate-500">Acceso temporal; las imágenes se eliminan al vencer su retención.</p></div><span className="text-xs text-slate-500">{shots.length} recientes</span></div>
      {shots.length ? <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shots.slice(0,18).map(s=><a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-slate-200"><img src={s.url} alt={`Captura de ${s.user}`} className="aspect-video w-full bg-slate-100 object-cover transition group-hover:scale-[1.02]"/><div className="p-3"><div className="font-semibold">{s.user}</div><div className="text-xs text-slate-500">{new Date(s.capturedAt).toLocaleString("es-ES")} · {s.appName || "Aplicación no indicada"}{s.blurred ? " · Difuminada" : ""}</div></div></a>)}</div> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Todavía no hay capturas. Se mostrarán cuando el agente de Windows o macOS esté vinculado.</p>}
    </section>
    {data.isAdmin && <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold">Instalar agente en un equipo</h2><p className="mt-1 text-sm text-slate-500">Genera una credencial individual, instala la aplicación y pégala una sola vez. Podrás revocarla desde Administración → API.</p>
      <div className="mt-4 flex flex-col gap-3 md:flex-row"><select value={enrollUser} onChange={e=>setEnrollUser(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2"><option value="">Seleccionar trabajador…</option>{data.members.map(m=><option key={m.id} value={m.id}>{m.name} · {m.email}</option>)}</select><button disabled={busy||!enrollUser} onClick={createEnrollment} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">Generar credencial</button></div>
      {enrollmentToken && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">Cópiala ahora: solo se muestra esta vez.</p><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded bg-white p-2 text-xs">{enrollmentToken}</code><button onClick={()=>navigator.clipboard.writeText(enrollmentToken)} className="rounded-lg border bg-white px-3 text-sm font-semibold">Copiar</button></div></div>}
      <p className="mt-4 text-xs text-slate-500">Windows y macOS utilizan el mismo token. El instalador de macOS aparecerá cuando esté firmado y notarizado por Apple.</p>
    </section>}
    <div className="flex gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900"><ShieldCheck className="shrink-0"/><p><b>Privacidad por diseño:</b> no se registran pulsaciones, contraseñas ni contenidos de formularios. Cada trabajador puede ver sus datos y activar tiempo privado.</p></div>
  </main>;
}

function Kpi({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) { return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-3 text-indigo-600">{icon}</div><div className="text-2xl font-bold">{value}</div><div className="text-sm text-slate-500">{label}</div></div> }
