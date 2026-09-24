"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import type { Nav } from "./SeoBlogApp";
import { api, Btn, Card, Empty, fmtDate, Score, StatusBadge } from "./ui";

export function PostRow({ p, nav }: { p: any; nav: Nav }) {
  return (
    <li>
      <button onClick={() => nav.openPost(p.id)} className="w-full text-left flex items-center gap-3 py-2.5 px-1 border-b last:border-0 hover:bg-amber-50/40">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.color }} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium truncate">{p.title}</span>
          <span className="block text-xs text-slate-500 truncate">
            {p.clientName} · {p.keyword} · {fmtDate(p.publishAt)}
            {["generando", "en_cola"].includes(p.status) && p.stepLabel ? ` · ${p.stepLabel}` : ""}
          </span>
        </span>
        <Score value={p.seoScore} />
        <StatusBadge status={p.status} />
      </button>
    </li>
  );
}

export default function PanelView({ nav }: { nav: Nav }) {
  const [posts, setPosts] = useState<any[] | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const q = nav.siteId ? `&siteId=${nav.siteId}` : "";
    const d = await api(`/posts?status=propuesta,planificada,en_cola,generando,revision,aprobada,programada,publicada,error${q}`);
    setPosts(d.items);
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    const t = setInterval(() => load().catch(() => null), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.siteId]);

  const s = nav.settings ?? {};
  const [check, setCheck] = useState<any>(null);
  useEffect(() => {
    api("/settings/check").then(setCheck).catch(() => setCheck(null));
  }, []);
  const warn: string[] = [];
  if (!s.anthropicConfigured) warn.push("Falta la API key de Anthropic (Configuración de IA).");
  if (!s.freepikConfigured) warn.push("Falta la API key de Freepik (Calendario editorial → ajustes). Sin ella los posts salen sin imágenes.");
  else if (check?.freepik && !check.freepik.ok) warn.push(`Los posts salen SIN IMÁGENES: ${check.freepik.message} → pega la clave nueva en la pestaña Ajustes.`);
  if (!s.serperConfigured) warn.push("Sin API key de Serper.dev: las propuestas y briefs se hacen sin datos reales de Google (recomendado activarla en Ajustes).");

  const cnt = (st: string[]) => (posts ?? []).filter((p) => st.includes(p.status)).length;
  const ym = new Date().toISOString().slice(0, 7);
  const upcoming = (posts ?? []).filter((p) => p.publishAt && p.status !== "publicada").sort((a, b) => a.publishAt.localeCompare(b.publishAt)).slice(0, 10);
  const working = (posts ?? []).filter((p) => ["en_cola", "generando", "error"].includes(p.status));

  const Kpi = ({ l, v, tab, hot }: { l: string; v: number; tab: string; hot?: boolean }) => (
    <button onClick={() => nav.go(tab)} className={"rounded-xl border p-4 text-left transition hover:border-amber-400 " + (hot ? "bg-slate-900 text-white" : "bg-white")}>
      <div className={"text-xs " + (hot ? "text-amber-200" : "text-slate-500")}>{l}</div>
      <div className={"text-3xl font-bold mt-1 " + (hot ? "text-amber-400" : "")}>{v}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      {warn.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          {warn.map((w) => <div key={w}>⚠️ {w}</div>)}
        </div>
      )}
      {nav.sites.length === 0 && (
        <Empty>
          Aún no hay clientes en el Publicador. <button className="text-amber-700 font-semibold underline" onClick={() => nav.go("clientes")}>Añade el primero</button> (se eligen de los clientes del CRM).
        </Empty>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi l="Clientes activos" v={nav.sites.filter((x) => x.active).length} tab="clientes" />
        <Kpi l="Propuestas pendientes" v={cnt(["propuesta"])} tab="propuestas" />
        <Kpi l="Planificados" v={cnt(["planificada", "en_cola", "generando"])} tab="calendario" />
        <Kpi l="Por revisar" v={cnt(["revision"])} tab="revision" hot={cnt(["revision"]) > 0} />
        <Kpi l="Programados en web" v={cnt(["aprobada", "programada"])} tab="calendario" />
        <Kpi l="Publicados este mes" v={(posts ?? []).filter((p) => p.status === "publicada" && (p.publishAt ?? "").slice(0, 7) === ym).length} tab="calendario" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Próximas publicaciones" actions={<button className="text-xs font-semibold text-amber-700" onClick={() => nav.go("calendario")}>Calendario →</button>}>
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
            La cola se procesa sola cada 2 minutos. La IA redacta cada post unos días antes de su fecha (configurable por cliente); después pasa a revisión o se programa directamente en su WordPress.
          </p>
        </Card>
      </div>
    </div>
  );
}
