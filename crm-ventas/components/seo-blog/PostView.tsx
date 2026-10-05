"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, CheckCircle2, ExternalLink, Plus, RefreshCw, Rocket, Trash2, Undo2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import type { Nav } from "./SeoBlogApp";
import { api, Btn, Card, Field, inputCls, Score, StatusBadge } from "./ui";

const PROGRESS = [
  ["research", "Investigación"], ["brief", "Brief SEO"], ["draft", "Redacción"], ["humanize", "Humanización"],
  ["seo", "Auditoría SEO"], ["images", "Imágenes"], ["assemble", "Montaje"]
] as const;
const stepIndex = (s: string) => {
  if (s === "seo_fix") return 4;
  if (s === "images_request" || s === "images_wait") return 5;
  const i = PROGRESS.findIndex(([k]) => k === s);
  return i < 0 ? 0 : i;
};
const TABS = [["preview", "Vista previa"], ["edit", "Editar"], ["seo", "SEO"], ["images", "Imágenes"], ["brief", "Brief"], ["schema", "Schema"], ["log", "Registro"]] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function PostView({ id, nav }: { id: string; nav: Nav }) {
  const [p, setP] = useState<any>(null);
  const [tab, setTab] = useState<string>("preview");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [regen, setRegen] = useState(false);
  const [live, setLive] = useState("");
  const alive = useRef(true);

  const load = async () => {
    const d = await api(`/posts/${id}`);
    if (alive.current) setP(d);
    return d;
  };
  useEffect(() => {
    alive.current = true;
    load().catch((e) => setMsg(e.message));
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Progreso en directo: ejecuta pasos mientras la página esté abierta (el planificador también avanza en segundo plano)
  const generating = p && ["en_cola", "generando"].includes(p.status);
  useEffect(() => {
    if (!generating) return;
    let stop = false;
    (async () => {
      while (!stop && alive.current) {
        let r: any;
        try {
          r = await api(`/posts/${id}/advance`, { method: "POST" });
        } catch (e: any) {
          r = { error: e.message, wait: true };
        }
        if (stop || !alive.current) return;
        if (r.wait || r.busy) {
          setLive(r.error ? r.error : r.pending ? `Generando imágenes (${r.pending} pendientes)…` : "Procesando en segundo plano…");
          await sleep(8000);
        }
        const d = await load().catch(() => null);
        if (!d || !["en_cola", "generando"].includes(d.status)) return;
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, id]);

  if (!p) return <p className="text-sm text-slate-400">{msg || "Cargando…"}</p>;

  const act = async (key: string, body: any, okMsg?: string) => {
    setBusy(key);
    setMsg("");
    try {
      const r = await api(`/posts/${id}/action`, { method: "POST", body });
      if (r?.error) setMsg(r.error);
      else if (okMsg) setMsg(okMsg);
      await load();
      await nav.reloadSite();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy("");
    }
  };
  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else nav.go("revision");
  };
  const dt = p.publishAtLocal ? p.publishAtLocal.replace(" ", "T") : "";
  const cur = stepIndex(p.step);

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex items-start gap-3 flex-wrap">
        <button type="button" onClick={back} className="text-sm text-brand-700 font-semibold flex items-center gap-1 mt-1"><ArrowLeft className="h-4 w-4" /> Volver</button>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />🔑 {p.keyword || "sin palabra clave"}</div>
          <h2 className="text-xl font-semibold leading-tight break-words">{p.title}</h2>
        </div>
        <div className="flex items-center gap-2"><StatusBadge status={p.status} /><Score value={p.seoScore} big /></div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <label className="flex items-center gap-2 text-sm font-medium flex-wrap">📅 Publicación
            <input type="datetime-local" value={dt} disabled={p.status === "publicada"} className="px-2 py-1.5 rounded-lg border text-sm"
              onChange={(e) => e.target.value && act("date", { action: "schedule", publishAt: e.target.value.replace("T", " ") }, "Fecha actualizada")} />
          </label>
          <div className="flex flex-wrap gap-2">
            {["propuesta", "planificada", "error", "descartada"].includes(p.status) && !p.content && (
              <Btn busy={busy === "gen"} onClick={() => act("gen", { action: "generate" })}>✨ Generar ahora</Btn>
            )}
            {p.status === "error" && <Btn busy={busy === "retry"} onClick={() => act("retry", { action: "retry" })}><RefreshCw className="h-4 w-4" /> Reintentar paso</Btn>}
            {p.status === "revision" && (
              <Btn variant="ok" busy={busy === "approve"} disabled={!p.publishAt} title={p.publishAt ? "" : "Asigna antes una fecha de publicación"}
                onClick={() => act("approve", { action: "approve", pushNow: true }, "Enviado a tu web")}><CheckCircle2 className="h-4 w-4" /> Aprobar y programar</Btn>
            )}
            {p.status === "aprobada" && (
              <Btn variant="ok" busy={busy === "push"} onClick={async () => {
                setBusy("push");
                try {
                  const r = await api(`/posts/${id}/advance`, { method: "POST" });
                  setMsg(r.error ? r.error : r.busy ? "Ya se está enviando en segundo plano…" : "Enviado a tu web");
                  await load();
                } catch (e: any) {
                  setMsg(e.message);
                } finally {
                  setBusy("");
                }
              }}><Rocket className="h-4 w-4" /> Enviar a la web ahora</Btn>
            )}
            {["aprobada", "programada"].includes(p.status) && <Btn variant="ghost" busy={busy === "back"} onClick={() => act("back", { action: "back_to_review" })}><Undo2 className="h-4 w-4" /> Volver a revisión</Btn>}
            {p.content && !generating && p.status !== "publicada" && <Btn variant="ghost" onClick={() => setRegen(true)}><RefreshCw className="h-4 w-4" /> Regenerar…</Btn>}
            {p.remoteUrl && <a href={p.remoteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium hover:bg-slate-50"><ExternalLink className="h-4 w-4" /> Ver en la web</a>}
            {p.status === "descartada" && <Btn variant="ghost" busy={busy === "restore"} onClick={() => act("restore", { action: "restore" }, "Restaurada como propuesta")}>Restaurar</Btn>}
            {p.status === "descartada" && (
              <Btn variant="danger" busy={busy === "delete"} onClick={async () => {
                if (!confirm("¿Eliminar definitivamente este post? No se puede deshacer.")) return;
                setBusy("delete");
                try {
                  await api(`/posts/${id}`, { method: "DELETE" });
                  await nav.reloadSite();
                  nav.go("propuestas");
                } catch (e: any) {
                  setMsg(e.message);
                  setBusy("");
                }
              }}><Trash2 className="h-4 w-4" /> Eliminar</Btn>
            )}
            {!["programada", "publicada", "descartada"].includes(p.status) && <Btn variant="danger" busy={busy === "discard"} onClick={() => act("discard", { action: "discard" }, "Descartado")}>Descartar</Btn>}
          </div>
        </div>
        {msg && <p className="text-sm mt-2 text-slate-600">{msg}</p>}
      </Card>

      {generating && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
          <div className="flex flex-wrap gap-1">
            {PROGRESS.map(([k, l], i) => (
              <div key={k} className={clsx("flex-1 min-w-[110px] flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5", i < cur && "text-emerald-800", i === cur && "bg-violet-100 text-violet-800 font-semibold")}>
                <span className={clsx("h-5 w-5 rounded-full grid place-items-center text-[10px] font-bold", i < cur ? "bg-emerald-200" : i === cur ? "bg-violet-600 text-white animate-pulse" : "bg-violet-100")}>{i < cur ? "✓" : i + 1}</span>{l}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-2">⏳ {live || p.stepLabel || "En cola"}… Puedes cerrar esta página: la generación continúa en segundo plano.</p>
        </div>
      )}
      {p.error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 break-words"><b>Error{p.step ? ` en «${p.stepLabel}»` : ""}:</b> {p.error}</div>}

      {!p.content ? (
        !generating && (
          <Card>
            {p.angle && <p className="text-sm"><b>Ángulo:</b> {p.angle}</p>}
            {p.rationale && <p className="text-sm mt-1"><b>Por qué:</b> {p.rationale}</p>}
            {p.notes && <p className="text-sm mt-1"><b>Instrucciones:</b> {p.notes}</p>}
            <p className="text-xs text-slate-500 mt-2">Este post aún no está redactado. Se generará automáticamente {p.leadDays} día(s) antes de su fecha, o pulsa «Generar ahora».</p>
          </Card>
        )
      ) : (
        <>
          <div className="flex gap-1 border-b overflow-x-auto">
            {TABS.map(([k, l]) => (
              <button type="button" key={k} onClick={() => setTab(k)} className={clsx("px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap", tab === k ? "border-brand-500 font-semibold" : "border-transparent text-slate-500")}>{l}</button>
            ))}
          </div>
          {tab === "preview" && <Preview p={p} />}
          {tab === "edit" && <Edit p={p} onSaved={(d) => { setP(d); setMsg(`Guardado · SEO ${d.seoScore}${p.status === "programada" ? " · se reenviará a la web" : ""}`); }} />}
          {tab === "seo" && <Seo p={p} onReaudit={() => act("reaudit", { action: "reaudit" })} />}
          {tab === "images" && <Images p={p} reload={load} onSaved={(d) => setP(d)} />}
          {tab === "brief" && <Brief b={p.brief ?? {}} />}
          {tab === "schema" && <Schema p={p} />}
          {tab === "log" && (
            <Card><ul className="font-mono text-xs divide-y">{(p.log ?? []).map((l: any) => (
              <li key={l.id} className={clsx("py-1.5 break-words", l.level === "error" && "text-rose-600", l.level === "warn" && "text-amber-700")}>
                <span className="text-slate-400 mr-2">{new Date(l.createdAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</span>{l.message}</li>
            ))}</ul>{!(p.log ?? []).length && <p className="text-sm text-slate-400">Sin actividad.</p>}</Card>
          )}
        </>
      )}

      <Modal open={regen} onClose={() => setRegen(false)} title="Regenerar post">
        <p className="text-sm mb-3">¿Desde qué punto quieres regenerar? (Puedes añadir instrucciones en «Editar → Instrucciones para la IA» antes.)</p>
        <div className="space-y-2">
          {[["draft", "Redacción (mantiene brief e investigación)"], ["humanize", "Solo la edición humanizada"], ["brief", "Brief SEO + redacción"], ["research", "Todo desde cero (nueva investigación SERP)"], ["images_request", "Solo las imágenes"]].map(([k, l]) => (
            <button type="button" key={k} className="w-full text-left rounded-lg border px-3 py-2 text-sm hover:border-brand-400 hover:bg-brand-50" onClick={async () => { setRegen(false); await act("gen", { action: "generate", from: k }); }}>{l}</button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function Preview({ p }: { p: any }) {
  const feat = (p.images ?? [])[0];
  let host = "";
  try { host = new URL(p.siteUrl).host; } catch {}
  const st = p.seoReport?.stats ?? {};
  return (
    <div className="grid xl:grid-cols-[1fr_320px] gap-4 min-w-0">
      <article className="bg-white rounded-xl border p-4 sm:p-10 nvp-article min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {feat?.previewUrl && <img src={feat.previewUrl} alt={feat.alt} className="w-full aspect-video object-cover rounded-lg mb-6" />}
        <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-4 break-words">{p.title}</h1>
        <div className="nvp-prose" dangerouslySetInnerHTML={{ __html: p.previewHtml }} />
      </article>
      <aside className="space-y-4 min-w-0">
        <Card title="Vista en Google">
          <div className="font-[Arial,sans-serif]">
            <div className="text-xs text-slate-600 break-all">{host} › {p.slug}</div>
            <div className="text-[19px] leading-snug text-[#1a0dab] my-1">{p.metaTitle || p.title}</div>
            <div className="text-[13px] text-slate-600 leading-relaxed">{p.metaDescription}</div>
          </div>
        </Card>
        <Card title="Datos">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Palabras</dt><dd>{st.words ?? "—"}</dd>
            <dt className="text-slate-500">Lectura</dt><dd>{st.readingMinutes ?? "—"} min</dd>
            <dt className="text-slate-500">Categoría</dt><dd>{p.category || "—"}</dd>
            <dt className="text-slate-500">Etiquetas</dt><dd>{(p.tags ?? []).join(", ") || "—"}</dd>
            <dt className="text-slate-500">Slug</dt><dd className="break-all">/{p.slug}/</dd>
            <dt className="text-slate-500">Extracto</dt><dd className="text-xs">{p.excerpt || "—"}</dd>
            <dt className="text-slate-500">Enlaces int./ext.</dt><dd>{st.internal ?? "—"} / {st.external ?? "—"}</dd>
            <dt className="text-slate-500">FAQ (schema)</dt><dd>{(p.faq ?? []).length} preguntas</dd>
          </dl>
        </Card>
      </aside>
      <style>{`.nvp-prose{font-family:Georgia,serif;font-size:17px;line-height:1.75;color:#1f2937;overflow-wrap:anywhere}.nvp-prose h2{font:700 22px/1.3 Inter,sans-serif;margin:32px 0 10px}.nvp-prose h3{font:600 17px/1.4 Inter,sans-serif;margin:22px 0 8px}.nvp-prose p{margin:0 0 14px}.nvp-prose ul,.nvp-prose ol{margin:0 0 14px 22px}.nvp-prose ul{list-style:disc}.nvp-prose ol{list-style:decimal}.nvp-prose a{color:#1d4ed8;text-decoration:underline}.nvp-prose figure{margin:22px 0}.nvp-prose img{border-radius:10px;max-width:100%;height:auto}.nvp-prose figcaption{font:13px Inter,sans-serif;color:#64748b;text-align:center;margin-top:6px}.nvp-prose table{display:block;overflow-x:auto;width:100%;border-collapse:collapse;font:14px Inter,sans-serif;margin:16px 0}.nvp-prose th,.nvp-prose td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left}.nvp-prose th{background:#f1f5f9}.nvp-prose blockquote{border-left:3px solid #cbd5e1;padding-left:14px;color:#475569;margin:0 0 14px}.nvp-prose .nvp-toc{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 18px;font:14px Inter,sans-serif;margin:18px 0}.nvp-prose .nvp-toc ol{margin:8px 0 0 18px}`}</style>
    </div>
  );
}

type Faq = { q: string; a: string };

function Edit({ p, onSaved }: { p: any; onSaved: (d: any) => void }) {
  const [f, setF] = useState({
    title: p.title, metaTitle: p.metaTitle, metaDescription: p.metaDescription, slug: p.slug, keyword: p.keyword,
    category: p.category, tags: (p.tags ?? []).join(", "), notes: p.notes ?? "", excerpt: p.excerpt ?? "", content: p.content ?? ""
  });
  const initialFaq: Faq[] = (p.faq ?? []).map((x: any) => ({ q: String(x.q ?? ""), a: String(x.a ?? "") }));
  const [faq, setFaq] = useState<Faq[]>(initialFaq);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const count = (v: string, max: number) => (
    <span className={clsx("ml-1 font-normal", v.length > max ? "text-rose-600" : v.length < max * 0.6 ? "text-amber-600" : "text-emerald-600")}>{v.length}/{max}</span>
  );
  const faqChanged = JSON.stringify(faq) !== JSON.stringify(initialFaq);
  return (
    <Card>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Field label="Título (H1)" wide><input value={f.title} onChange={set("title")} className={inputCls} /></Field>
        <Field label={<span>Meta title {count(f.metaTitle, 60)}</span>} wide><input value={f.metaTitle} onChange={set("metaTitle")} className={inputCls} /></Field>
        <Field label={<span>Meta description {count(f.metaDescription, 155)}</span>} wide><textarea rows={2} value={f.metaDescription} onChange={set("metaDescription")} className={inputCls} /></Field>
        <Field label="Slug"><input value={f.slug} onChange={set("slug")} className={inputCls} /></Field>
        <Field label="Palabra clave principal"><input value={f.keyword} onChange={set("keyword")} className={inputCls} /></Field>
        <Field label="Categoría"><input value={f.category} onChange={set("category")} className={inputCls} /></Field>
        <Field label="Etiquetas (comas)" wide><input value={f.tags} onChange={set("tags")} className={inputCls} /></Field>
        <Field label="Extracto" help="Resumen que muestra WordPress en el listado del blog. Vacío = la meta description." wide><textarea rows={2} value={f.excerpt} onChange={set("excerpt")} className={inputCls} /></Field>
        <Field label="Instrucciones para la IA (se usan al regenerar)" wide><textarea rows={2} value={f.notes} onChange={set("notes")} className={inputCls} /></Field>
        <div className="sm:col-span-2 lg:col-span-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-700">Preguntas frecuentes (sección del post y schema FAQPage)</span>
            <Btn size="sm" variant="ghost" onClick={() => setFaq([...faq, { q: "", a: "" }])}><Plus className="h-3.5 w-3.5" /> Añadir pregunta</Btn>
          </div>
          {faq.map((x, i) => (
            <div key={i} className="rounded-lg border p-2 space-y-1.5">
              <div className="flex gap-2">
                <input value={x.q} placeholder="¿Pregunta?" onChange={(e) => setFaq(faq.map((y, j) => (j === i ? { ...y, q: e.target.value } : y)))} className={inputCls} />
                <button type="button" aria-label="Quitar pregunta" className="text-slate-400 hover:text-rose-600 px-1" onClick={() => setFaq(faq.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
              <textarea rows={2} value={x.a} placeholder="Respuesta (40–80 palabras)" onChange={(e) => setFaq(faq.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)))} className={inputCls} />
            </div>
          ))}
          {!faq.length && <p className="text-xs text-slate-500">Sin preguntas frecuentes.</p>}
          {faqChanged && <p className="text-[11px] text-amber-700">Al guardar se reescribe la sección «Preguntas frecuentes» del contenido.</p>}
        </div>
        <Field label="Contenido (HTML)" help="Los marcadores <!--NVP_IMG_n--> indican dónde van las imágenes." wide>
          <textarea rows={26} value={f.content} onChange={set("content")} className={inputCls + " font-mono text-xs"} />
        </Field>
      </div>
      {err && <p className="text-sm text-rose-600 mt-3">{err}</p>}
      <div className="flex justify-end mt-4">
        <Btn busy={busy} onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            const body: any = { ...f, tags: f.tags.split(",").map((s: string) => s.trim()).filter(Boolean) };
            if (f.content === (p.content ?? "")) delete body.content;
            if (faqChanged) body.faq = faq.filter((x) => x.q.trim() && x.a.trim());
            const d = await api(`/posts/${p.id}`, { method: "PATCH", body });
            onSaved(d);
            setF((cur) => ({ ...cur, content: d.content ?? "" }));
            setFaq((d.faq ?? []).map((x: any) => ({ q: String(x.q ?? ""), a: String(x.a ?? "") })));
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}>Guardar y auditar</Btn>
      </div>
    </Card>
  );
}

function Seo({ p, onReaudit }: { p: any; onReaudit: () => void }) {
  const r = p.seoReport ?? {};
  const s = r.stats ?? {};
  const score = p.seoScore ?? 0;
  const color = score >= 85 ? "#16a34a" : score >= 70 ? "#f59e0b" : "#e11d48";
  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <Card>
        <div className="relative h-36 w-36 mx-auto">
          <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90"><circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(score / 100) * 326.7} 326.7`} /></svg>
          <div className="absolute inset-0 grid place-items-center"><div className="text-center"><div className="text-4xl font-bold">{score}</div><div className="text-xs text-slate-500">/100</div></div></div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm mt-4">
          <dt className="text-slate-500">Palabras</dt><dd>{s.words}</dd>
          <dt className="text-slate-500">Densidad keyword</dt><dd>{s.density}% ({s.occurrences}×)</dd>
          <dt className="text-slate-500">H2 / H3</dt><dd>{s.h2} / {s.h3}</dd>
          <dt className="text-slate-500">Enlaces internos</dt><dd>{s.internal}</dd>
          <dt className="text-slate-500">Enlaces externos</dt><dd>{s.external}</dd>
          <dt className="text-slate-500">FAQ</dt><dd>{s.faq}</dd>
          <dt className="text-slate-500">Frase media</dt><dd>{s.avgSentence} palabras</dd>
        </dl>
        <Btn variant="ghost" size="sm" className="mt-3" onClick={onReaudit}>Re-auditar</Btn>
      </Card>
      <Card title="Checklist on-page">
        <ul className="divide-y">
          {(r.checks ?? []).map((c: any) => (
            <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
              <span className={clsx("h-5 w-5 rounded-full grid place-items-center text-[11px] font-bold shrink-0", c.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>{c.ok ? "✓" : "✕"}</span>
              <span className="flex-1 min-w-0 break-words">{c.label}</span><span className="text-[11px] text-slate-400">{c.w} pts</span>
            </li>
          ))}
        </ul>
        {(r.issues ?? []).length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            <b>Cómo mejorar:</b>
            <ul className="list-disc ml-4 mt-1 space-y-0.5">{(r.issues as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        <p className="text-xs text-slate-500 mt-3">Además, en todos los posts: schema BlogPosting + FAQPage, índice con anclas, imágenes WebP con alt/título/leyenda, nombres de archivo SEO, enlazado interno a URLs reales de tu web y cero enlaces inventados.</p>
      </Card>
    </div>
  );
}

function Images({ p, reload, onSaved }: { p: any; reload: () => Promise<any>; onSaved: (d: any) => void }) {
  const imgs: any[] = p.images?.length ? p.images : p.brief?.images ?? [];
  const allFailed = imgs.length > 0 && imgs.every((i) => i.status === "failed");
  const firstErr = imgs.find((i) => i.status === "failed")?.error ?? "";
  const [subjects, setSubjects] = useState<string[]>(imgs.map((i) => i.subject ?? ""));
  const [meta, setMeta] = useState(imgs.map((i) => ({ alt: i.alt ?? "", title: i.title ?? "", caption: i.caption ?? "" })));
  const [busy, setBusy] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const metaChanged = meta.some((m, i) => m.alt !== (imgs[i]?.alt ?? "") || m.title !== (imgs[i]?.title ?? "") || m.caption !== (imgs[i]?.caption ?? ""));
  const setM = (i: number, k: "alt" | "title" | "caption", v: string) => setMeta((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  return (
    <div>
      {allFailed && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <b>No se han podido generar las imágenes.</b> {firstErr}
          <div className="text-xs mt-1 text-rose-600">Cuando el servicio vuelva a estar disponible, pulsa «Regenerar… → Solo las imágenes» en este post.</div>
        </div>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {imgs.map((im, i) => (
          <div key={i} className="bg-white rounded-xl border overflow-hidden min-w-0">
            {im.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={im.previewUrl} alt={im.alt} className="w-full aspect-video object-cover" />
            ) : (
              <div className="w-full aspect-video grid place-items-center bg-slate-100 text-xs text-slate-500 p-4 text-center">
                {im.status === "pending" ? "⏳ Generando…" : im.status === "failed" ? `⚠️ ${im.error || "Falló"}` : "Sin imagen"}
              </div>
            )}
            <div className="p-3 space-y-1.5 text-xs">
              <span className="inline-block rounded bg-brand-50 text-brand-800 px-1.5 py-0.5 text-[10px] uppercase">{i === 0 ? "Portada" : "En el texto"}</span>
              {im.text_in_image && <p><b>Texto en la imagen:</b> «{im.text_in_image}»</p>}
              <Field label="Texto alternativo (alt)"><input value={meta[i]?.alt ?? ""} onChange={(e) => setM(i, "alt", e.target.value)} className={inputCls + " text-xs"} /></Field>
              <Field label="Título"><input value={meta[i]?.title ?? ""} onChange={(e) => setM(i, "title", e.target.value)} className={inputCls + " text-xs"} /></Field>
              <Field label="Leyenda"><input value={meta[i]?.caption ?? ""} onChange={(e) => setM(i, "caption", e.target.value)} className={inputCls + " text-xs"} /></Field>
              <Field label="Escena (inglés)"><textarea rows={3} value={subjects[i] ?? ""} onChange={(e) => setSubjects((s) => s.map((x, j) => (j === i ? e.target.value : x)))} className={inputCls + " text-xs"} /></Field>
              <Btn size="sm" variant="ghost" busy={busy === i} disabled={busy >= 0} onClick={async () => {
                setBusy(i);
                setMsg("");
                try {
                  await api(`/posts/${p.id}/action`, { method: "POST", body: { action: "regen_image", index: i, subject: subjects[i] } });
                  setMsg("Imagen encargada. Se actualiza en ~1 min.");
                  await reload();
                  for (let k = 0; k < 30; k++) {
                    await new Promise((r) => setTimeout(r, 8000));
                    const r = await api(`/posts/${p.id}/action`, { method: "POST", body: { action: "poll_images" } });
                    if (!r.pending) break;
                  }
                  await reload();
                } catch (e: any) {
                  setMsg(e.message);
                } finally {
                  setBusy(-1);
                }
              }}><RefreshCw className="h-3.5 w-3.5" /> Regenerar esta imagen</Btn>
            </div>
          </div>
        ))}
      </div>
      {imgs.length > 0 && (
        <div className="flex items-center justify-end gap-3 mt-3">
          {metaChanged && <span className="text-xs text-amber-700">Hay cambios sin guardar en los textos de las imágenes.</span>}
          <Btn busy={saving} disabled={!metaChanged} onClick={async () => {
            setSaving(true);
            setMsg("");
            try {
              const d = await api(`/posts/${p.id}`, { method: "PATCH", body: { imageMeta: meta.map((m, index) => ({ index, ...m })) } });
              onSaved(d);
              setMsg(`Textos de las imágenes guardados${p.status === "programada" ? " · se reenviará a la web" : ""}.`);
            } catch (e: any) {
              setMsg(e.message);
            } finally {
              setSaving(false);
            }
          }}>Guardar textos de imágenes</Btn>
        </div>
      )}
      {msg && <p className="text-xs text-slate-600 mt-2">{msg}</p>}
      <p className="text-xs text-slate-500 mt-3">Las imágenes se generan con IA (Freepik) usando las referencias de estilo de tu marca y se suben a tu web en WebP (máx. 1600 px). Los cambios de alt/título/leyenda se aplican al enviar el post.</p>
    </div>
  );
}

function Brief({ b }: { b: any }) {
  const List = ({ items, render }: { items: any[]; render: (x: any, i: number) => React.ReactNode }) =>
    items?.length ? <ul className="list-disc ml-5 space-y-1 text-sm">{items.map(render)}</ul> : <p className="text-sm text-slate-400">—</p>;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Estructura">
        <List items={b.outline ?? []} render={(o: any, i) => (
          <li key={i}><b>{o.h2}</b> <span className="text-xs text-slate-500">{o.notes}</span>{o.h3?.length ? <ul className="list-[circle] ml-5">{o.h3.map((h: string) => <li key={h}>{h}</li>)}</ul> : null}</li>
        )} />
        <h4 className="font-semibold text-sm mt-4 mb-1">Ganancia de información</h4>
        <List items={b.information_gain ?? []} render={(x: string, i) => <li key={i}>{x}</li>} />
        <h4 className="font-semibold text-sm mt-4 mb-1">Dónde aportar experiencia propia</h4>
        <List items={b.experience_points ?? []} render={(x: string, i) => <li key={i}>{x}</li>} />
      </Card>
      <Card title="Lector e intención">
        <p className="text-sm">{b.reader}</p>
        <p className="text-sm mt-1"><b>Intención:</b> {b.search_intent}</p>
        <h4 className="font-semibold text-sm mt-4 mb-1">Entidades semánticas</h4>
        <div className="flex flex-wrap gap-1">{(b.entities ?? []).map((e: string) => <span key={e} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{e}</span>)}</div>
        <h4 className="font-semibold text-sm mt-4 mb-1">Enlaces internos</h4>
        <List items={b.internal_links ?? []} render={(l: any, i) => <li key={i}><a href={/^https?:\/\//i.test(l.url) ? l.url : "#"} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{l.anchor}</a> <span className="text-xs text-slate-400 break-all">{l.url}</span></li>} />
        <h4 className="font-semibold text-sm mt-4 mb-1">Enlaces externos</h4>
        <List items={b.external_links ?? []} render={(l: any, i) => <li key={i}><a href={/^https?:\/\//i.test(l.url) ? l.url : "#"} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{l.anchor}</a> <span className="text-xs text-slate-400">{l.reason}</span></li>} />
        <h4 className="font-semibold text-sm mt-4 mb-1">FAQ</h4>
        <List items={b.faq ?? []} render={(q: any, i) => <li key={i}>{typeof q === "string" ? q : q.q}</li>} />
      </Card>
    </div>
  );
}

function Schema({ p }: { p: any }) {
  const json = p.schemaJson ? JSON.stringify(p.schemaJson, null, 2) : "";
  return (
    <Card title="Datos estructurados (JSON-LD)">
      <p className="text-xs text-slate-500 mb-3">
        {p.schemaSent
          ? "Este es el schema que se envió a tu web."
          : "Así se enviará a tu web al publicar."}{" "}
        Incluye BlogPosting y FAQPage (las preguntas frecuentes del post). Con el plugin NV SEO Bridge se imprime en la cabecera de la página; si usas Yoast o Rank Math, solo se añade el FAQPage para no duplicar el artículo. Los valores %%…%% (enlace, fechas, imagen de portada) se rellenan al publicar.
      </p>
      {json ? <pre className="text-[11px] bg-slate-50 border rounded-lg p-3 overflow-auto max-h-[60vh]">{json}</pre> : <p className="text-sm text-slate-400">—</p>}
    </Card>
  );
}
