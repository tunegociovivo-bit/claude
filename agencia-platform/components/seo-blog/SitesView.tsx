"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Download, Palette, Plus, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import type { Nav, Site } from "./SeoBlogApp";
import { api, Btn, Card, Empty, Field, inputCls } from "./ui";

const SUBTABS = [
  ["negocio", "Negocio y voz"],
  ["wp", "Conexión WordPress"],
  ["keywords", "Palabras clave"],
  ["estilo", "Estilo visual"],
  ["publicacion", "Publicación"]
] as const;

export default function SitesView({ nav, openSiteId, sub }: { nav: Nav; openSiteId: string; sub: string }) {
  const [adding, setAdding] = useState(false);
  if (openSiteId) return <SiteDetail nav={nav} id={openSiteId} sub={sub || "negocio"} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Añadir cliente</Btn>
      </div>
      {nav.sites.length === 0 ? (
        <Empty>Activa el Publicador SEO para un cliente del CRM con «Añadir cliente».</Empty>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {nav.sites.map((s) => (
            <button key={s.id} onClick={() => nav.go("clientes", { site: s.id })}
              className={clsx("text-left bg-white rounded-xl border p-4 hover:shadow-md transition border-t-4", !s.active && "opacity-60")}
              style={{ borderTopColor: s.color }}>
              <div className="font-semibold">{s.clientName}</div>
              <div className="text-xs text-slate-500 truncate">{s.siteUrl || "Sin web conectada"}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-xs text-slate-500">
                <span><b className="text-slate-800">{s.kwCount}</b> keywords</span>
                <span><b className="text-slate-800">{s.refCount}</b> referencias</span>
                <span><b className="text-slate-800">{s.ideasCount}</b> propuestas</span>
                <span><b className="text-slate-800">{s.plannedCount}</b> en curso</span>
                <span><b className="text-slate-800">{s.publishedCount}</b> publicados</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3 text-[11px]">
                <span className={clsx("rounded-full px-2 py-0.5", s.hasPassword ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{s.hasPassword ? "WP conectado" : "WP sin conectar"}</span>
                <span className="rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">{s.autoPublish ? "Publica sin revisión" : "Con revisión"}</span>
                {s.bridgeDetected && <span className="rounded-full px-2 py-0.5 bg-amber-50 text-amber-700">SEO Bridge</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      <AddSiteModal open={adding} onClose={() => setAdding(false)} nav={nav} />
    </div>
  );
}

function AddSiteModal({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: Nav }) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/clients").then((r) => r.json()).then((d) => setClients((d.items ?? []).map((c: any) => ({ id: c.id, name: c.name })))).catch(() => null);
  }, [open]);
  const taken = new Set(nav.sites.map((s) => s.clientId));
  const list = clients.filter((c) => !taken.has(c.id) && c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open={open} onClose={onClose} title="Añadir cliente al Publicador SEO">
      <input autoFocus placeholder="Buscar cliente del CRM…" value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} />
      <div className="mt-3 max-h-[50vh] overflow-auto divide-y">
        {list.map((c) => (
          <div key={c.id} className="flex items-center justify-between py-2">
            <span className="text-sm">{c.name}</span>
            <Btn size="sm" busy={busy === c.id} onClick={async () => {
              setBusy(c.id);
              try {
                const s = await api("/sites", { method: "POST", body: { clientId: c.id } });
                await nav.reloadSites();
                onClose();
                nav.go("clientes", { site: s.id, sub: "wp" });
              } catch (e: any) {
                alert(e.message);
              } finally {
                setBusy("");
              }
            }}>Añadir</Btn>
          </div>
        ))}
        {!list.length && <p className="py-6 text-center text-sm text-slate-500">No hay clientes disponibles con ese nombre.</p>}
      </div>
    </Modal>
  );
}

function SiteDetail({ nav, id, sub }: { nav: Nav; id: string; sub: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const s = await api<Site>(`/sites/${id}`);
    setSite(s);
    setForm({ ...s, wpAppPassword: "" });
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!site) return <div className="text-sm text-slate-400">{msg || "Cargando…"}</div>;

  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const txt = (k: string, label: string, opts: { help?: string; ph?: string; type?: string; wide?: boolean } = {}) => (
    <Field label={label} help={opts.help} wide={opts.wide}>
      <input type={opts.type ?? "text"} value={form[k] ?? ""} onChange={set(k)} placeholder={opts.ph} className={inputCls} />
    </Field>
  );
  const area = (k: string, label: string, opts: { help?: string; ph?: string; rows?: number } = {}) => (
    <Field label={label} help={opts.help} wide>
      <textarea rows={opts.rows ?? 3} value={form[k] ?? ""} onChange={set(k)} placeholder={opts.ph} className={inputCls} />
    </Field>
  );
  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const s = await api<Site>(`/sites/${id}`, { method: "PATCH", body: form });
      setSite(s);
      setForm({ ...s, wpAppPassword: "" });
      await nav.reloadSites();
      setMsg("Guardado ✓");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };
  const saveBar = (extra?: React.ReactNode) => (
    <div className="flex items-center justify-end gap-3 mt-4">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      {extra}
      <Btn busy={saving} onClick={save}>Guardar cambios</Btn>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={() => nav.go("clientes")} className="text-sm text-amber-700 font-semibold flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Clientes</button>
        <h2 className="text-lg font-semibold flex items-center gap-2 flex-1"><span className="h-3 w-3 rounded-full" style={{ background: site.color }} />{site.clientName}</h2>
        <Btn variant="ghost" size="sm" onClick={() => { nav.setSiteFilter(site.id); nav.go("propuestas"); }}>Ver propuestas</Btn>
        <Btn variant="danger" size="sm" onClick={async () => {
          if (!confirm(`¿Quitar a ${site.clientName} del Publicador? Se borran sus keywords, referencias y posts del Hub (no se toca nada en su web ni en el CRM).`)) return;
          await api(`/sites/${id}`, { method: "DELETE" });
          await nav.reloadSites();
          nav.go("clientes");
        }}><Trash2 className="h-3.5 w-3.5" /> Quitar</Btn>
      </div>
      <div className="flex gap-1 border-b mb-4 overflow-x-auto">
        {SUBTABS.map(([k, l]) => (
          <button key={k} onClick={() => nav.go("clientes", { site: id, sub: k })}
            className={clsx("px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap", sub === k ? "border-amber-500 font-semibold" : "border-transparent text-slate-500")}>{l}</button>
        ))}
      </div>

      {sub === "negocio" && (
        <Card>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {txt("sector", "Sector / actividad", { ph: "Clínica de injerto capilar" })}
            {txt("location", "Ubicación / zona de servicio", { ph: "Marbella y Costa del Sol" })}
            <Field label="Idioma">
              <select value={form.language} onChange={set("language")} className={inputCls}>
                {[["es-ES", "Español (España)"], ["es-MX", "Español (México)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"], ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["it-IT", "Italiano"], ["pt-PT", "Português"], ["ca-ES", "Català"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            {area("businessInfo", "Datos reales del negocio (servicios, equipo, años, certificaciones, diferenciales…)", { rows: 4, help: "La IA solo afirma datos que estén aquí o en la ficha del CRM (brief de marca). Nunca inventa cifras, premios ni testimonios." })}
            {area("audience", "Público objetivo", { ph: "Hombres 30-55 con alopecia androgenética que buscan una solución definitiva…" })}
            {txt("tone", "Tono", { ph: "Cercano, experto, tranquilizador. Trato de tú." })}
            {txt("ctaText", "Llamada a la acción", { ph: "Pide tu valoración gratuita" })}
            {txt("ctaUrl", "URL de la llamada a la acción", { ph: "https://…/contacto/" })}
            {area("brandVoice", "Voz de marca (expresiones propias, cómo habla)")}
            {area("compliance", "Restricciones legales / cumplimiento (obligatorias)", { ph: "Publicidad sanitaria: sin promesas de resultados, sin antes/después, sin precios promocionales…" })}
            {area("forbidden", "Palabras o temas prohibidos", { rows: 2 })}
            {area("competitors", "Competidores (dominios, uno por línea)", { rows: 2, help: "Nunca se enlazan ni se citan." })}
            <Field label="Color en el calendario"><input type="color" value={form.color ?? "#C9962E"} onChange={set("color")} className="h-9 w-16 rounded border" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.active} onChange={set("active")} /> Cliente activo</label>
          </div>
          {saveBar()}
        </Card>
      )}

      {sub === "wp" && <WpTab site={site} form={form} set={set} txt={txt} saveBar={saveBar} onSaved={load} />}
      {sub === "keywords" && <KeywordsTab siteId={id} />}
      {sub === "estilo" && <StyleTab siteId={id} form={form} setForm={setForm} set={set} saveBar={saveBar} />}

      {sub === "publicacion" && (
        <Card>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3"><input type="checkbox" className="mt-1" checked={!!form.autoPublish} onChange={set("autoPublish")} />
              <span><b>Publicar sin revisión humana</b><br /><span className="text-xs text-slate-500">El post se programa en la web en cuanto está redactado. Si está desactivado, queda «En revisión» hasta que alguien lo apruebe.</span></span></label>
            {txt("leadDays", "Días de antelación para redactar", { type: "number", help: "La IA redacta el post N días antes de su fecha para dar margen a la revisión." })}
            {txt("publishTime", "Hora de publicación por defecto", { type: "time" })}
            {txt("wordsMin", "Extensión mínima (palabras)", { type: "number" })}
            {txt("wordsMax", "Extensión máxima (palabras)", { type: "number" })}
          </div>
          {saveBar()}
        </Card>
      )}
    </div>
  );
}

function WpTab({ site, form, set, txt, saveBar, onSaved }: any) {
  const [testing, setTesting] = useState(false);
  const [res, setRes] = useState<any>(null);
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {txt("siteUrl", "URL de la web WordPress", { ph: "https://www.cliente.com", wide: true })}
          {txt("wpUser", "Usuario WordPress", { help: "Rol Editor o Administrador." })}
          <Field label="Application Password" help="WP del cliente → Usuarios → Perfil → Contraseñas de aplicación. Se guarda cifrada.">
            <input type="password" autoComplete="new-password" value={form.wpAppPassword ?? ""} onChange={set("wpAppPassword")}
              placeholder={site.hasPassword ? "•••••••• (guardada — escribe para cambiarla)" : "xxxx xxxx xxxx xxxx xxxx xxxx"} className={inputCls} />
          </Field>
          {txt("wpAuthorId", "ID de autor en la web (opcional)", { type: "number", help: "Un autor real con biografía refuerza E-E-A-T." })}
          {txt("defaultCategory", "Categoría por defecto (opcional)", { help: "Vacío = la IA propone la categoría (se crea si no existe)." })}
        </div>
        {res && (
          <div className={clsx("mt-4 rounded-lg p-3 text-sm", res.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200")}>
            {res.ok ? (
              <>✅ Conectado como <b>{res.user}</b> (ID {res.userId}) en «{res.siteName}» · {res.pagesFound} páginas/posts indexados para el enlazado interno<br />
                Publicar: {res.canPublish ? "✅" : "❌"} · Subir medios: {res.canUpload ? "✅" : "❌"} · NV SEO Bridge: {res.bridge ? "✅" : "⚠️ no instalado"} · Yoast: {res.yoast ? "✅" : "—"} · Rank Math: {res.rankmath ? "✅" : "—"}</>
            ) : <>❌ {res.error}</>}
            {res.fixedUrl && <div className="mt-1 text-xs">ℹ️ La URL guardada no era la raíz del WordPress; se ha corregido automáticamente a <b>{res.fixedUrl}</b>.</div>}
          </div>
        )}
        {saveBar(
          <Btn variant="ghost" busy={testing} onClick={async () => {
            setTesting(true);
            try {
              await api(`/sites/${site.id}`, { method: "PATCH", body: form });
              await onSaved();
              const r = await api(`/sites/${site.id}/test`, { method: "POST" });
              setRes(r);
              if (r?.fixedUrl) await onSaved();
            } catch (e: any) {
              setRes({ ok: false, error: e.message });
            } finally {
              setTesting(false);
            }
          }}>Guardar y probar conexión</Btn>
        )}
      </Card>
      <Card title="Plugin puente recomendado en la web del cliente">
        <p className="text-sm text-slate-600">
          Instala <b>NV SEO Bridge</b> (un solo archivo, sin ajustes) en la web del cliente para que el meta title, la meta description y la keyword se escriban
          directamente en <b>Yoast</b> o <b>Rank Math</b>, y para imprimir el schema JSON-LD (Article + FAQPage) en el &lt;head&gt;. Sin él el post se publica igual y el schema va
          embebido en el contenido.
        </p>
        <a href="/api/v1/seo-blog/bridge" className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-amber-700"><Download className="h-4 w-4" /> Descargar nv-seo-bridge.php</a>
      </Card>
    </div>
  );
}

function KeywordsTab({ siteId }: { siteId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [kw, setKw] = useState("");
  const [prio, setPrio] = useState("2");
  const [vol, setVol] = useState("");
  const [bulk, setBulk] = useState<string | null>(null);
  const [sugg, setSugg] = useState<any[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const load = async () => setItems((await api(`/sites/${siteId}/keywords`)).items);
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);
  const add = async (body: any) => {
    const r = await api(`/sites/${siteId}/keywords`, { method: "POST", body });
    setItems(r.items);
    return r.added as number;
  };
  const patch = async (id: string, body: any) => {
    try {
      await api(`/keywords/${id}`, { method: "PATCH", body });
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  return (
    <Card
      title={`Palabras clave (${items.length})`}
      actions={
        <Btn variant="ghost" size="sm" busy={busy === "sugg"} onClick={async () => {
          setBusy("sugg");
          try {
            const r = await api(`/sites/${siteId}/keywords/suggest`, { method: "POST" });
            setSugg(r.items);
            setPicked(new Set(r.items.map((_: any, i: number) => i)));
          } catch (e: any) {
            setMsg(e.message);
          } finally {
            setBusy("");
          }
        }}><Sparkles className="h-3.5 w-3.5" /> Sugerir con IA</Btn>
      }
    >
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && kw.trim() && add({ keyword: kw, priority: prio, volume: vol }).then(() => setKw(""))}
          placeholder="Nueva palabra clave (p. ej. injerto capilar marbella)" className={inputCls + " flex-[2] min-w-[240px]"} />
        <select value={prio} onChange={(e) => setPrio(e.target.value)} className={inputCls + " w-40"}><option value="1">Prioridad alta</option><option value="2">Prioridad media</option><option value="3">Prioridad baja</option></select>
        <input type="number" value={vol} onChange={(e) => setVol(e.target.value)} placeholder="Volumen (opc.)" className={inputCls + " w-36"} />
        <Btn onClick={() => kw.trim() && add({ keyword: kw, priority: prio, volume: vol }).then(() => setKw(""))}>Añadir</Btn>
        <Btn variant="ghost" onClick={() => setBulk("")}>Añadir en bloque</Btn>
      </div>
      {msg && <p className="text-xs text-rose-600 mb-2">{msg}</p>}
      {items.length === 0 ? (
        <Empty>Añade las palabras clave objetivo del cliente. Consejo: mezcla términos de servicio + localidad y long-tails informacionales.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-500 border-b">
              <th className="py-2 pr-2">Keyword</th><th className="pr-2">Tipo</th><th className="pr-2">Intención</th><th className="pr-2">Prioridad</th><th className="pr-2">Volumen</th><th className="pr-2">Preguntas de Google</th><th /></tr></thead>
            <tbody>
              {items.map((k) => (
                <tr key={k.id} className="border-b last:border-0 align-middle">
                  <td className="py-1.5 pr-2"><input defaultValue={k.keyword} onBlur={(e) => e.target.value !== k.keyword && patch(k.id, { keyword: e.target.value })} className="w-full px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-amber-400 outline-none" /></td>
                  <td className="pr-2"><select defaultValue={k.kwType} onChange={(e) => patch(k.id, { kwType: e.target.value })} className="px-1 py-1 rounded border-transparent bg-transparent">{["principal", "secundaria", "longtail"].map((o) => <option key={o}>{o}</option>)}</select></td>
                  <td className="pr-2"><select defaultValue={k.intent} onChange={(e) => patch(k.id, { intent: e.target.value })} className="px-1 py-1 rounded bg-transparent"><option value="">—</option>{["informacional", "comercial", "transaccional", "local", "navegacional"].map((o) => <option key={o}>{o}</option>)}</select></td>
                  <td className="pr-2"><select defaultValue={String(k.priority)} onChange={(e) => patch(k.id, { priority: e.target.value })} className="px-1 py-1 rounded bg-transparent"><option value="1">Alta</option><option value="2">Media</option><option value="3">Baja</option></select></td>
                  <td className="pr-2"><input type="number" defaultValue={k.volume ?? ""} onBlur={(e) => patch(k.id, { volume: e.target.value })} className="w-20 px-2 py-1 rounded border border-transparent hover:border-slate-200" /></td>
                  <td className="pr-2 max-w-[340px]">{(k.paa ?? []).slice(0, 3).map((q: string) => <span key={q} className="inline-block m-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">{q}</span>)}{!(k.paa ?? []).length && <span className="text-[11px] text-slate-400">Se obtienen al generar propuestas</span>}</td>
                  <td><button className="text-slate-400 hover:text-rose-600" title="Eliminar" onClick={async () => { if (!confirm("¿Eliminar esta palabra clave?")) return; await api(`/keywords/${k.id}`, { method: "DELETE" }); load(); }}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={bulk !== null} onClose={() => setBulk(null)} title="Añadir palabras clave en bloque"
        footer={<div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setBulk(null)}>Cancelar</Btn><Btn onClick={async () => { const n = await add({ bulk }); setMsg(`${n} palabras clave añadidas`); setBulk(null); }}>Añadir</Btn></div>}>
        <p className="text-xs text-slate-500 mb-2">Una por línea. Opcional: <code>keyword | prioridad(1-3) | volumen</code></p>
        <textarea rows={10} value={bulk ?? ""} onChange={(e) => setBulk(e.target.value)} className={inputCls} placeholder={"injerto capilar marbella | 1 | 880\nprecio injerto capilar | 1\ninjerto capilar fue opiniones | 2"} />
      </Modal>
      <Modal open={!!sugg} onClose={() => setSugg(null)} title="Sugerencias de palabras clave"
        footer={<div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setSugg(null)}>Cancelar</Btn><Btn onClick={async () => { const n = await add({ items: (sugg ?? []).filter((_, i) => picked.has(i)) }); setMsg(`${n} añadidas`); setSugg(null); }}>Añadir seleccionadas</Btn></div>}>
        <div className="space-y-2">
          {(sugg ?? []).map((k, i) => (
            <label key={i} className="flex gap-2 items-start text-sm">
              <input type="checkbox" className="mt-1" checked={picked.has(i)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
              <span><b>{k.keyword}</b> <span className="text-xs text-slate-500">{k.kw_type} · {k.intent} · P{k.priority}</span><br /><span className="text-xs text-slate-500">{k.why}</span></span>
            </label>
          ))}
        </div>
      </Modal>
    </Card>
  );
}

function StyleTab({ siteId, form, setForm, set, saveBar }: any) {
  const [refs, setRefs] = useState<any[]>([]);
  const [storage, setStorage] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = async () => {
    const d = await api(`/sites/${siteId}/refs`);
    setRefs(d.items);
    setStorage(d.storage);
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);
  const upload = async (files: File[]) => {
    setUploading(true);
    setMsg("");
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const d = await api(`/sites/${siteId}/refs`, { method: "POST", body: fd });
        setRefs(d.items);
      }
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card title={`Imágenes de referencia (${refs.length})`} actions={
        <Btn variant="ghost" size="sm" busy={importing} onClick={async () => {
          setImporting(true);
          try {
            const r = await api(`/sites/${siteId}/refs/import-editorial`, { method: "POST" });
            setMsg(r.found ? `${r.imported} de ${r.found} referencias importadas del calendario editorial` : "Este cliente no tiene referencias en el calendario editorial");
            await load();
          } catch (e: any) {
            setMsg(e.message);
          } finally {
            setImporting(false);
          }
        }}><Download className="h-3.5 w-3.5" /> Importar del editorial</Btn>
      }>
        {!storage && <p className="text-sm text-rose-600 mb-2">El almacenamiento R2 del Hub no está configurado: no se pueden subir referencias.</p>}
        <p className="text-xs text-slate-500 mb-3">La IA toma de aquí la paleta, la luz, el encuadre y el ambiente. Se usan hasta 5 referencias en cada imagen generada (Seedream 4.5 Edit).</p>
        <div
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"))); }}
          className={clsx("rounded-xl border-2 border-dashed p-6 text-center text-sm cursor-pointer transition", over ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-slate-50/60", uploading && "opacity-50 pointer-events-none")}
        >
          <Upload className="h-5 w-5 mx-auto text-slate-400" />
          <div className="mt-1">{uploading ? "Subiendo…" : <>Arrastra imágenes aquí o <u>haz clic para subir</u></>}</div>
          <div className="text-xs text-slate-500">JPG, PNG o WEBP · mín. 256 px · fotos reales de la marca, de su web o redes</div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload(Array.from(e.target.files ?? []))} />
        </div>
        {msg && <p className="text-xs text-slate-600 mt-2">{msg}</p>}
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2 mt-4">
          {refs.map((r) => (
            <figure key={r.id} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt="" className="h-full w-full object-cover" />
              <button onClick={async () => { if (!confirm("¿Eliminar referencia?")) return; await api(`/refs/${r.id}`, { method: "DELETE" }); load(); }}
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white text-sm opacity-0 group-hover:opacity-100">×</button>
            </figure>
          ))}
        </div>
      </Card>
      <Card title="Guía de estilo visual" actions={
        <Btn variant="ghost" size="sm" busy={analyzing} disabled={!refs.length} onClick={async () => {
          setAnalyzing(true);
          try {
            const r = await api(`/sites/${siteId}/style`, { method: "POST" });
            setForm((f: any) => ({ ...f, visualStyle: r.style_prompt }));
            setSummary(r);
          } catch (e: any) {
            setMsg(e.message);
          } finally {
            setAnalyzing(false);
          }
        }}><Palette className="h-3.5 w-3.5" /> Analizar estilo con IA</Btn>
      }>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Descripción del estilo (en inglés, se envía a Seedream)" help="Se rellena al analizar las referencias. Puedes editarla." wide>
            <textarea rows={5} value={form.visualStyle ?? ""} onChange={set("visualStyle")} className={inputCls} />
          </Field>
          <Field label="Indicaciones adicionales" wide>
            <textarea rows={2} value={form.visualNotes ?? ""} onChange={set("visualNotes")} className={inputCls} placeholder="Mediterranean light, real clinic interiors, diverse adults 30-55…" />
          </Field>
          <Field label="Imágenes por post (portada incluida)"><input type="number" min={1} max={6} value={form.imagesPerPost ?? 3} onChange={set("imagesPerPost")} className={inputCls} /></Field>
          <Field label="Formato">
            <select value={form.imageAspect} onChange={set("imageAspect")} className={inputCls}>
              <option value="widescreen_16_9">16:9 panorámico</option><option value="standard_3_2">3:2 fotográfico</option><option value="classic_4_3">4:3 clásico</option><option value="square_1_1">1:1 cuadrado</option>
            </select>
          </Field>
        </div>
        {summary && (
          <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
            <Wand2 className="inline h-4 w-4 mr-1" />{summary.summary_es}
            <div className="flex gap-1 mt-2">{(summary.palette ?? []).map((h: string) => <span key={h} title={h} className="h-6 w-6 rounded border" style={{ background: h }} />)}</div>
          </div>
        )}
        {saveBar()}
      </Card>
    </div>
  );
}
