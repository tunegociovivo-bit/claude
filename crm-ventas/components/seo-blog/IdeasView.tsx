"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Plus, Sparkles, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import type { Nav } from "./SeoBlogApp";
import { api, Btn, Empty, Field, inputCls, todayISO } from "./ui";

export default function IdeasView({ nav }: { nav: Nav }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [gen, setGen] = useState(false);
  const [manual, setManual] = useState(false);
  const [dist, setDist] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [bulkBusy, setBulkBusy] = useState("");

  const load = async () => {
    const d = await api(`/posts?status=propuesta`);
    setItems(d.items);
    setSel(new Set());
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const action = async (id: string, body: any) => {
    setMsg("");
    try {
      await api(`/posts/${id}/action`, { method: "POST", body });
      setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
      if (body.action === "schedule") setMsg(`Planificada para el ${body.publishAt}. La verás en el calendario.`);
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  const bulk = async (kind: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBulkBusy(kind);
    setMsg("");
    try {
      const r = await api("/posts/bulk", { method: "POST", body: { ids: [...sel], action: kind } });
      if (kind === "generate") setMsg(`${r.updated} post(s) en cola de redacción. Los verás avanzar en «Revisión → En producción».`);
      await load();
      await nav.reloadSite();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBulkBusy("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <p className="text-xs text-slate-500 flex-1 min-w-[240px]">Las propuestas son solo título, palabra clave y enfoque. El texto y las imágenes se crean al generar el post (elige propuestas → «Repartir en calendario», o pulsa «Generar post»).</p>
        <Btn variant="ghost" onClick={() => setManual(true)}><Plus className="h-4 w-4" /> Post manual</Btn>
        <Btn onClick={() => setGen(true)}><Sparkles className="h-4 w-4" /> Generar propuestas con IA</Btn>
      </div>
      {sel.size > 0 && (
        <div className="sticky top-16 md:top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2.5">
          <span className="flex-1 text-sm font-medium min-w-[120px]">{sel.size} seleccionada(s)</span>
          <Btn size="sm" className="bg-brand-500 hover:bg-brand-400 text-white" onClick={() => setDist(true)}><CalendarPlus className="h-3.5 w-3.5" /> Repartir en calendario</Btn>
          <Btn size="sm" variant="ghost" busy={bulkBusy === "generate"} onClick={() => bulk("generate", `¿Redactar ya ${sel.size} post(s)? La IA empezará ahora (sin esperar a su fecha).`)}><Sparkles className="h-3.5 w-3.5" /> Generar ya</Btn>
          <Btn size="sm" variant="ghost" busy={bulkBusy === "discard"} onClick={() => bulk("discard")}>Descartar</Btn>
          <Btn size="sm" variant="ghost" busy={bulkBusy === "delete"} onClick={() => bulk("delete", `¿Eliminar definitivamente ${sel.size} propuesta(s)?`)}>Eliminar</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSel(new Set((items ?? []).map((x) => x.id)))}>Todas</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSel(new Set())}>Ninguna</Btn>
        </div>
      )}
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
      {!items ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : items.length === 0 ? (
        <Empty>No hay propuestas pendientes. Pulsa «Generar propuestas con IA».</Empty>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((p) => (
            <article key={p.id} className="bg-white rounded-xl border border-l-4 p-4 flex flex-col gap-2 min-w-0" style={{ borderLeftColor: p.color }}>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4" aria-label="Seleccionar" />
                {p.intent && <span className="text-[10px] uppercase tracking-wide bg-brand-50 text-brand-800 rounded px-1.5 py-0.5">{p.intent}</span>}
                {p.funnel && <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{p.funnel}</span>}
              </div>
              <h4 className="font-semibold leading-snug">{p.title}</h4>
              <div className="text-xs text-slate-600">🔑 <b>{p.keyword || "—"}</b>{p.secondaryKeywords?.length ? ` · ${p.secondaryKeywords.slice(0, 4).join(", ")}` : ""}</div>
              {p.angle && <p className="text-xs text-slate-700">{p.angle}</p>}
              {p.rationale && <p className="text-xs text-slate-500">{p.rationale}</p>}
              {p.notes && <p className="text-xs bg-brand-50 rounded px-2 py-1">📝 {p.notes}</p>}
              <div className="mt-auto pt-2 border-t flex items-center gap-2 flex-wrap">
                <label className="flex w-full items-center gap-1.5 text-xs">Publicar el
                  <input type="date" min={todayISO()} className="min-w-0 flex-1 px-2 py-1 rounded border text-xs" onChange={(e) => e.target.value && action(p.id, { action: "schedule", publishAt: e.target.value })} />
                </label>
                <Btn size="sm" onClick={async () => {
                  try {
                    await api(`/posts/${p.id}/action`, { method: "POST", body: { action: "generate" } });
                    nav.openPost(p.id);
                  } catch (e: any) {
                    setMsg(e.message);
                  }
                }}><Sparkles className="h-3.5 w-3.5" /> Generar post</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setEdit(p)}>Editar</Btn>
                <button type="button" title="Descartar" aria-label="Descartar" className="text-slate-400 hover:text-rose-600" onClick={() => action(p.id, { action: "discard" })}><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      <GenerateModal open={gen} onClose={() => setGen(false)} nav={nav} onDone={(n) => { setMsg(`${n} propuestas nuevas`); load(); nav.reloadSite(); }} />
      <ManualModal open={manual} onClose={() => setManual(false)} onDone={load} />
      <DistributeModal open={dist} ids={[...sel]} publishTime={nav.site.publishTime} onClose={() => setDist(false)} onDone={() => { setDist(false); nav.go("calendario"); }} />
      <EditModal post={edit} onClose={() => setEdit(null)} onDone={load} />
    </div>
  );
}

function GenerateModal({ open, onClose, nav, onDone }: { open: boolean; onClose: () => void; nav: Nav; onDone: (n: number) => void }) {
  const [n, setN] = useState(12);
  const [focus, setFocus] = useState("");
  const [kws, setKws] = useState<any[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const siteId = nav.site.id;
  useEffect(() => {
    if (!open) return;
    setErr("");
    setN(Number(nav.settings?.ideasPerRun) || 12);
    api(`/sites/${siteId}/keywords`).then((d) => { setKws(d.items); setPicked(new Set(d.items.map((k: any) => k.id))); }).catch(() => setKws([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId]);
  return (
    <Modal open={open} onClose={onClose} title="Generar propuestas con IA" size="lg"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn busy={busy} disabled={!kws.length || !picked.size} onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            const r = await api(`/sites/${siteId}/ideas`, { method: "POST", body: { n, focus, keywordIds: [...picked] } });
            onClose();
            onDone(r.created);
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Investigando y generando…" : "Generar"}</Btn></>}>
      <div className="space-y-3">
        <Field label="Número de propuestas"><input type="number" min={3} max={30} value={n} onChange={(e) => setN(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Palabras clave a trabajar">
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
            {kws.length ? kws.map((k) => (
              <label key={k.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-normal cursor-pointer">
                <input type="checkbox" checked={picked.has(k.id)} onChange={() => setPicked((s) => { const x = new Set(s); x.has(k.id) ? x.delete(k.id) : x.add(k.id); return x; })} /> {k.keyword}
              </label>
            )) : (
              <span className="text-rose-600 font-normal">
                Aún no tienes palabras clave.{" "}
                <button type="button" className="underline" onClick={() => { onClose(); nav.go("web", { sub: "keywords" }); }}>Añádelas en «Web y conexión»</button>.
              </span>
            )}
          </div>
        </Field>
        <Field label="Indicaciones para esta tanda (opcional)">
          <textarea rows={3} value={focus} onChange={(e) => setFocus(e.target.value)} className={inputCls} placeholder="Enfocar en temporada de verano; priorizar artículos de precios…" />
        </Field>
        <p className="text-xs text-slate-500">La IA consulta Google (top 10, «La gente también pregunta», búsquedas relacionadas) y los artículos ya publicados en tu web para no repetir temas. Tarda ~1 min.</p>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}

function ManualModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: "", keyword: "", notes: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ title: "", keyword: "", notes: "" }); setErr(""); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Añadir post manual"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn busy={busy} disabled={!f.title.trim()} onClick={async () => {
        setBusy(true);
        try { await api("/posts", { method: "POST", body: f }); onClose(); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>Añadir</Btn></>}>
      <div className="space-y-3">
        <Field label="Título de trabajo"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} /></Field>
        <Field label="Palabra clave principal"><input value={f.keyword} onChange={(e) => setF({ ...f, keyword: e.target.value })} className={inputCls} /></Field>
        <Field label="Instrucciones para la IA"><textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} /></Field>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}

function DistributeModal({ open, ids, publishTime, onClose, onDone }: { open: boolean; ids: string[]; publishTime?: string; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState("");
  const [days, setDays] = useState<Set<number>>(new Set([2, 4]));
  const [perDay, setPerDay] = useState(1);
  const [time, setTime] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      const t = new Date(Date.now() + 864e5);
      setStart(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(t));
      setErr("");
    }
  }, [open]);
  const DAYS: [number, string][] = [[1, "L"], [2, "M"], [3, "X"], [4, "J"], [5, "V"], [6, "S"], [7, "D"]];
  return (
    <Modal open={open} onClose={onClose} title="Repartir en el calendario"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn busy={busy} disabled={!days.size} onClick={async () => {
        setBusy(true);
        try { await api("/posts/bulk", { method: "POST", body: { ids, action: "distribute", start, weekdays: [...days], perDay, time } }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>Repartir</Btn></>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{ids.length} posts se asignarán en orden a los días elegidos.</p>
        <Field label="Empezar el"><input type="date" min={todayISO()} value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} /></Field>
        <Field label="Días de publicación">
          <div className="flex gap-1.5 flex-wrap">{DAYS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setDays((s) => { const x = new Set(s); x.has(v) ? x.delete(v) : x.add(v); return x; })}
              className={"h-9 w-9 rounded-full text-xs font-semibold " + (days.has(v) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}>{l}</button>
          ))}</div>
        </Field>
        <Field label="Posts por día"><input type="number" min={1} max={5} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className={inputCls} /></Field>
        <Field label={`Hora (vacío = la de tu web${publishTime ? `, ${publishTime}` : ""})`}><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></Field>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}

function EditModal({ post, onClose, onDone }: { post: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (post) {
      setF({ title: post.title, keyword: post.keyword, angle: post.angle ?? "", notes: post.notes ?? "", secondary: (post.secondaryKeywords ?? []).join(", ") });
      setErr("");
    }
  }, [post]);
  return (
    <Modal open={!!post} onClose={onClose} title="Editar propuesta" size="lg"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn busy={busy} onClick={async () => {
        setBusy(true);
        try {
          await api(`/posts/${post.id}`, { method: "PATCH", body: { title: f.title, keyword: f.keyword, angle: f.angle, notes: f.notes, secondaryKeywords: String(f.secondary).split(",").map((s: string) => s.trim()).filter(Boolean) } });
          onClose();
          onDone();
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setBusy(false);
        }
      }}>Guardar</Btn></>}>
      <div className="space-y-3">
        <Field label="Título"><input value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} /></Field>
        <Field label="Palabra clave principal"><input value={f.keyword ?? ""} onChange={(e) => setF({ ...f, keyword: e.target.value })} className={inputCls} /></Field>
        <Field label="Secundarias (separadas por comas)"><input value={f.secondary ?? ""} onChange={(e) => setF({ ...f, secondary: e.target.value })} className={inputCls} /></Field>
        <Field label="Ángulo"><textarea rows={2} value={f.angle ?? ""} onChange={(e) => setF({ ...f, angle: e.target.value })} className={inputCls} /></Field>
        <Field label="Instrucciones para el redactor IA"><textarea rows={3} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} placeholder="Menciona nuestra garantía de 5 años; enlaza la página de presupuesto…" /></Field>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}
