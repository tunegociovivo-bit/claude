"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import type { Nav } from "./SeoBlogApp";
import { api, Btn, Card, Empty, fmtDate, Score, StatusBadge } from "./ui";

export function PostRow({ p, nav }: { p: any; nav: Nav }) {
  return (
    <li>
      <button type="button" onClick={() => nav.openPost(p.id)} className="w-full text-left flex items-center gap-3 py-2.5 px-1 border-b last:border-0 hover:bg-brand-50/40">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.color }} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium truncate">{p.title}</span>
          <span className="block text-xs text-slate-500 truncate">
            {p.keyword || "sin palabra clave"} · {fmtDate(p.publishAt)}
            {["generando", "en_cola"].includes(p.status) && p.stepLabel ? ` · ${p.stepLabel}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          <Score value={p.seoScore} />
          <StatusBadge status={p.status} />
        </span>
      </button>
    </li>
  );
}

export default function PanelView({ nav }: { nav: Nav }) {
  const [posts, setPosts] = useState<any[] | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const d = await api(`/posts?status=propuesta,planificada,en_cola,generando,revision,aprobada,programada,publicada,error`);
    setPosts(d.items);
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    const t = setInterval(() => load().catch(() => null), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const services = nav.settings?.services ?? {};
  const [check, setCheck] = useState<any>(null);
  useEffect(() => {
    if (nav.isAdmin && services.images) api("/settings/check").then(setCheck).catch(() => setCheck(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.isAdmin]);
  const site = nav.site;
  const warn: string[] = [];
  if (!services.writing) warn.push("La redacción con IA no está disponible ahora mismo. Avisa a Negocio Vivo.");
  if (!services.images) warn.push("La generación de imágenes no está disponible; avisa a Negocio Vivo. Mientras tanto, los posts se crean sin imágenes.");
  else if (check?.freepik && !check.freepik.ok) warn.push(`Los posts salen SIN IMÁGENES: ${check.freepik.message}`);
  if (!services.google) warn.push("Los datos de Google (top 10, «La gente también pregunta») no están disponibles: las propuestas y briefs se hacen sin ellos. Avisa a Negocio Vivo si quieres activarlos.");

  const cnt = (st: string[]) => (posts ?? []).filter((p) => st.includes(p.status)).length;
  const ym = new Date().toISOString().slice(0, 7);
  const upcoming = (posts ?? []).filter((p) => p.publishAt && p.status !== "publicada").sort((a, b) => a.publishAt.localeCompare(b.publishAt)).slice(0, 10);
  const working = (posts ?? []).filter((p) => ["en_cola", "generando", "error"].includes(p.status));

  const Kpi = ({ l, v, tab, hot }: { l: string; v: number; tab: string; hot?: boolean }) => (
    <button type="button" onClick={() => nav.go(tab)} className={"rounded-xl border p-4 text-left transition hover:border-brand-400 " + (hot ? "bg-slate-900 text-white" : "bg-white")}>
      <div className={"text-xs " + (hot ? "text-brand-200" : "text-slate-500")}>{l}</div>
      <div className={"text-3xl font-bold mt-1 " + (hot ? "text-brand-300" : "")}>{v}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      {warn.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          {warn.map((w) => <div key={w}>⚠️ {w}</div>)}
        </div>
      )}
      {!site.hasPassword && (
        <Empty>
          Tu web aún no está conectada con WordPress.{" "}
          <button type="button" className="text-brand-700 font-semibold underline" onClick={() => nav.go("web", { sub: "wp" })}>Conéctala en «Web y conexión»</button>{" "}
          (son 3 pasos con el plugin NV SEO Bridge). Mientras tanto puedes preparar palabras clave y propuestas.
        </Empty>
      )}
      {site.hasPassword && !site.kwCount && (
        <Empty>
          Añade las palabras clave por las que quieres aparecer en Google.{" "}
          <button type="button" className="text-brand-700 font-semibold underline" onClick={() => nav.go("web", { sub: "keywords" })}>Ir a palabras clave</button>
        </Empty>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi l="Palabras clave" v={site.kwCount ?? 0} tab="web" />
        <Kpi l="Propuestas pendientes" v={cnt(["propuesta"])} tab="propuestas" />
        <Kpi l="Planificados" v={cnt(["planificada", "en_cola", "generando"])} tab="calendario" />
        <Kpi l="Por revisar" v={cnt(["revision"])} tab="revision" hot={cnt(["revision"]) > 0} />
        <Kpi l="Programados en web" v={cnt(["aprobada", "programada"])} tab="calendario" />
        <Kpi l="Publicados este mes" v={(posts ?? []).filter((p) => p.status === "publicada" && (p.publishAt ?? "").slice(0, 7) === ym).length} tab="calendario" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Próximas publicaciones" actions={<button type="button" className="text-xs font-semibold text-brand-700" onClick={() => nav.go("calendario")}>Calendario →</button>}>
          {upcoming.length ? <ul>{upcoming.map((p) => <PostRow key={p.id} p={p} nav={nav} />)}</ul> : <Empty>No hay publicaciones planificadas. Ve a Propuestas y asigna fechas.</Empty>}
        </Card>
        <Card
          title="En proceso"
          actions={
            <Btn variant="ghost" size="sm" busy={running} onClick={async () => {
              setRunning(true);
              try {
                const r = await api("/run-queue", { method: "POST" });
                setMsg(`${r.processed} paso(s) ejecutados · ${r.pending} en cola`);
                await load();
              } catch (e: any) {
                setMsg(e.message);
              } finally {
                setRunning(false);
              }
            }}>
              <Play className="h-3.5 w-3.5" /> Procesar cola ahora
            </Btn>
          }
        >
          {working.length ? <ul>{working.map((p) => <PostRow key={p.id} p={p} nav={nav} />)}</ul> : <Empty>Nada generándose ahora mismo.</Empty>}
          {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
          <p className="mt-3 text-xs text-slate-500">
            La cola se procesa sola cada 2 minutos. La IA redacta cada post {site.leadDays} día(s) antes de su fecha (configurable en «Web y conexión → Publicación»); después pasa a revisión o se programa directamente en tu WordPress.
          </p>
        </Card>
      </div>
    </div>
  );
}
