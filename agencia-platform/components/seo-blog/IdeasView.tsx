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

  const load = async () => {
    const d = await api(`/posts?status=propuesta${nav.siteId ? `&siteId=${nav.siteId}` : ""}`);
    setItems(d.items);
    setSel(new Set());
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.siteId]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const action = async (id: string, body: any) => {
    try {
      await api(`/posts/${id}/action`, { method: "POST", body });
      setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <p className="text-xs text-slate-500 flex-1 min-w-[260px]">Las propuestas son solo título, keyword y enfoque. El texto y las imágenes se crean al generar el post (elige propuestas → «Repartir en calendario», o abre una y pulsa «Generar ahora»).</p>
        <Btn variant="ghost" onClick={() => setManual(true)}><Plus className="h-4 w-4" /> Post manual</Btn>
        <Btn onClick={() => setGen(true)} disabled={!nav.sites.length}><Sparkles className="h-4 w-4" /> Generar propuestas con IA</Btn>
      </div>
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2.5">
          <span className="flex-1 text-sm font-medium">{sel.size} seleccionada(s)</span>
          <Btn size="sm" className="bg-amber-500 hover:bg-amber-400 text-slate-900" onClick={() => setDist(true)}><CalendarPlus className="h-3.5 w-3.5" /> Repartir en calendario</Btn>
          <Btn size="sm" variant="ghost" onClick={async () => { await api("/posts/bulk", { method: "POST", body: { ids: [...sel], action: "discard" } }); load(); }}>Descartar</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSel(new Set((items ?? []).map((x) => x.id)))}>Todas</Btn>
        </div>
      )}
      {msg && <p className="text-sm text-rose-600">{msg}</p>}
      {!items ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : items.length === 0 ? (
        <Empty>No hay propuestas pendientes{nav.siteId ? " para este cliente" : ""}. Pulsa «Generar propuestas con IA».</Empty>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((p) => (
            <article key={p.id} className="bg-white rounded-xl border border-l-4 p-4 flex flex-col gap-2" style={{ borderLeftColor: p.color }}>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4" />
                <span className="text-xs font-semibold" style={{ color: p.color }}>{p.clientName}</span>
                {p.intent && <span className="text-[10px] uppercase tracking-wide bg-amber-50 text-amber-800 rounded px-1.5 py-0.5">{p.intent}</span>}
                {p.funnel && <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{p.funnel}</span>}
              </div>
              <h4 className="font-semibold leading-snug">{p.title}</h4>
              <div className="text-xs text-slate-600">🔑 <b>{p.keyword}</b>{p.secondaryKeywords?.length ? ` · ${p.secondaryKeywords.slice(0, 4).join(", ")}` : ""}</div>
              {p.angle && <p className="text-xs text-slate-700">{p.angle}</p>}
              {p.rationale && <p className="text-xs text-slate-500">{p.rationale}</p>}
              {p.notes && <p className="text-xs bg-amber-50 rounded px-2 py-1">📝 {p.notes}</p>}
              <div className="mt-auto pt-2 border-t flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs flex-1">Publicar el
                  <input type="date" min={todayISO()} className="px-2 py-1 rounded border text-xs" onChange={(e) => e.target.value && action(p.id, { action: "schedule", publishAt: e.target.value })} />
                </label>
                <Btn size="sm" variant="ghost" onClick={() => setEdit(p)}>Editar</Btn>
                <button title="Descartar" className="text-slate-400 hover:text-rose-600" onClick={() => action(p.id, { action: "discard" })}><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      <GenerateModal open={gen} onClose={() => setGen(false)} nav={nav} onDone={load} />
      <ManualModal open={manual} onClose={() => setManual(false)} nav={nav} onDone={load} />
      <DistributeModal open={dist} ids={[...sel]} onClose={() => setDist(false)} onDone={() => { setDist(false); nav.go("calendario"); }} />
      <EditModal post={edit} onClose={() => setEdit(null)} onDone={load} />
    </div>
  );
}

function GenerateModal({ open, onClose, nav, onDone }: { open: boolean; onClose: () => void; nav: Nav; onDone: () => void }) {
  const [siteId, setSiteId] = useState("");
  const [n, setN] = useState(12);
  const [focus, setFocus] = useState("");
  const [kws, setKws] = useState<any[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (open) setSiteId(nav.siteId || nav.sites.find((s) => s.active)?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!siteId) return;
    api(`/sites/${siteId}/keywords`).then((d) => { setKws(d.items); setPicked(new Set(d.items.map((k: any) => k.id))); }).catch(() => setKws([]));
  }, [siteId]);
  return (
    <Modal open={open} onClose={onClose} title="Generar propuestas con IA"
      footer={<div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn busy={busy} disabled={!kws.length} onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            const r = await api(`/sites/${siteId}/ideas`, { method: "POST", body: { n, focus, keywordIds: [...picked] } });
            nav.setSiteFilter(siteId);
            onClose();
            onDone();
            alert(`${r.created} propuestas nuevas`);
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Investigando y generando…" : "Generar"}</Btn></div>}>
      <div className="space-y-3">
        <Field label="Cliente">
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputCls}>
            {nav.sites.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.clientName}</option>)}
          </select>
        </Field>
        <Field label="Número de propuestas"><input type="number" min={3} max={30} value={n} onChange={(e) => setN(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Palabras clave a trabajar">
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
            {kws.length ? kws.map((k) => (
              <label key={k.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-normal cursor-pointer">
                <input type="checkbox" checked={picked.has(k.id)} onChange={() => setPicked((s) => { const x = new Set(s); x.has(k.id) ? x.delete(k.id) : x.add(k.id); return x; })} /> {k.keyword}
              </label>
            )) : <span className="text-rose-600 font-normal">Este cliente no tiene palabras clave. Añádelas en su ficha.</span>}
          </div>
        </Field>
        <Field label="Indicaciones para esta tanda (opcional)">
          <textarea rows={3} value={focus} onChange={(e) => setFocus(e.target.value)} className={inputCls} placeholder="Enfocar en temporada de verano; priorizar artículos de precios…" />
        </Field>
        <p className="text-xs text-slate-500">La IA consulta Google (top 10, «La gente también pregunta», búsquedas relacionadas) y los artículos ya publicados para evitar canibalización. Tarda ~1 min.</p>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}

function ManualModal({ open, onClose, nav, onDone }: { open: boolean; onClose: () => void; nav: Nav; onDone: () => void }) {
  const [f, setF] = useState({ siteId: "", title: "", keyword: "", notes: "" });
  useEffect(() => { if (open) setF({ siteId: nav.siteId || nav.sites[0]?.id || "", title: "", keyword: "", notes: "" }); }, [open, nav.siteId, nav.sites]);
  return (
    <Modal open={open} onClose={onClose} title="Añadir post manual"
      footer={<div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn onClick={async () => { try { await api("/posts", { method: "POST", body: f }); onClose(); onDone(); } catch (e: any) { alert(e.message); } }}>Añadir</Btn></div>}>
      <div className="space-y-3">
        <Field label="Cliente"><select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })} className={inputCls}>{nav.sites.map((s) => <option key={s.id} value={s.id}>{s.clientName}</option>)}</select></Field>
        <Field label="Título de trabajo"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} /></Field>
        <Field label="Palabra clave principal"><input value={f.keyword} onChange={(e) => setF({ ...f, keyword: e.target.value })} className={inputCls} /></Field>
        <Field label="Instrucciones para la IA"><textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} /></Field>
      </div>
    </Modal>
  );
}

function DistributeModal({ open, ids, onClose, onDone }: { open: boolean; ids: string[]; onClose: () => void; onDone: () => void }) {
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const [start, setStart] = useState(tomorrow);
  const [days, setDays] = useState<Set<number>>(new Set([2, 4]));
  const [perDay, setPerDay] = useState(1);
  const [time, setTime] = useState("");
  const DAYS: [number, string][] = [[1, "L"], [2, "M"], [3, "X"], [4, "J"], [5, "V"], [6, "S"], [7, "D"]];
  return (
    <Modal open={open} onClose={onClose} title="Repartir en el calendario"
      footer={<div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn onClick={async () => { await api("/posts/bulk", { method: "POST", body: { ids, action: "distribute", start, weekdays: [...days], perDay, time } }); onDone(); }}>Repartir</Btn></div>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{ids.length} posts se asignarán en orden a los días elegidos.</p>
        <Field label="Empezar el"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} /></Field>
        <Field label="Días de publicación">
          <div className="flex gap-1.5">{DAYS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setDays((s) => { const x = new Set(s); x.has(v) ? x.delete(v) : x.add(v); return x; })}
              className={"h-8 w-8 rounded-full text-xs font-semibold " + (days.has(v) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}>{l}</button>
          ))}</div>
        </Field>
        <Field label="Posts por día"><input type="number" min={1} max={5} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Hora (vacío = la del cliente)"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></Field>
      </div>
    </Modal>
  );
}

function EditModal({ post, onClose, onDone }: { post: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (post) setF({ title: post.title, keyword: post.keyword, angle: post.angle ?? "", notes: post.notes ?? "", secondary: (post.secondaryKeywords ?? []).join(", ") });
  }, [post]);
  return (
    <Modal open={!!post} onClose={onClose} title="Editar propuesta"
      footer={<div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn onClick={async () => {
        await api(`/posts/${post.id}`, { method: "PATCH", body: { title: f.title, keyword: f.keyword, angle: f.angle, notes: f.notes, secondaryKeywords: String(f.secondary).split(",").map((s: string) => s.trim()).filter(Boolean) } });
        onClose();
        onDone();
      }}>Guardar</Btn></div>}>
      <div className="space-y-3">
        <Field label="Título"><input value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} /></Field>
        <Field label="Palabra clave principal"><input value={f.keyword ?? ""} onChange={(e) => setF({ ...f, keyword: e.target.value })} className={inputCls} /></Field>
        <Field label="Secundarias (separadas por comas)"><input value={f.secondary ?? ""} onChange={(e) => setF({ ...f, secondary: e.target.value })} className={inputCls} /></Field>
        <Field label="Ángulo"><textarea rows={2} value={f.angle ?? ""} onChange={(e) => setF({ ...f, angle: e.target.value })} className={inputCls} /></Field>
        <Field label="Instrucciones para el redactor IA"><textarea rows={3} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} placeholder="Menciona nuestro protocolo post-operatorio de 12 meses; enlaza la página de financiación…" /></Field>
      </div>
    </Modal>
  );
}
