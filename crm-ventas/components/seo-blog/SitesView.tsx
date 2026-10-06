"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Download, Palette, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import type { Nav, Site } from "./SeoBlogApp";
import { api, Btn, Card, Empty, Field, fmtDate, inputCls } from "./ui";

/**
 * «Web y conexión»: la única web del negocio en el Publicador (en el Hub era la
 * ficha de cada cliente). Mismas pestañas y campos; sin lista de webs ni alta.
 */
const SUBTABS = [
  ["negocio", "Negocio y voz"],
  ["wp", "Conexión WordPress"],
  ["keywords", "Palabras clave"],
  ["estilo", "Estilo visual"],
  ["publicacion", "Publicación"]
] as const;

export default function SitesView({ nav, sub }: { nav: Nav; sub: string }) {
  const tab = SUBTABS.some(([k]) => k === sub) ? sub : nav.site.hasPassword ? "negocio" : "wp";
  return <SiteDetail nav={nav} id={nav.site.id} sub={tab} />;
}

function SiteDetail({ nav, id, sub }: { nav: Nav; id: string; sub: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [aUrl, setAUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [aMsg, setAMsg] = useState("");

  const load = async () => {
    const s = await api<Site>(`/sites/${id}`);
    setSite(s);
    setForm({ ...s, wpAppPassword: "" });
    setAUrl((u) => u || s.siteUrl || "");
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => setMsg(""), [sub]);
  if (!site) return <div className="text-sm text-slate-400">{msg || "Cargando…"}</div>;

  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const txt = (k: string, label: string, opts: { help?: string; ph?: string; type?: string; wide?: boolean; disabled?: boolean } = {}) => (
    <Field label={label} help={opts.help} wide={opts.wide}>
      <input type={opts.type ?? "text"} value={form[k] ?? ""} onChange={set(k)} placeholder={opts.ph} disabled={opts.disabled} className={inputCls} />
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
      await nav.reloadSite();
      setMsg("Guardado ✓");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };
  const analyze = async () => {
    if (!aUrl.trim() || analyzing) return;
    const hasData = ["sector", "location", "businessInfo", "audience", "tone", "ctaText", "brandVoice", "compliance", "forbidden", "competitors"].some((k) => String(form[k] ?? "").trim());
    if (hasData && !confirm("La IA va a sustituir los datos de «Negocio y voz» por lo que encuentre en tu web. Los campos que no pueda rellenar se quedan como están. ¿Continuar?")) return;
    setAnalyzing(true);
    setAMsg("");
    setMsg("");
    try {
      const r = await api<{ site: Site; pages: string[]; filled: string[]; competitors: { source: string; count: number } }>(`/sites/${id}/analyze`, { method: "POST", body: { url: aUrl } });
      setSite(r.site);
      setForm({ ...r.site, wpAppPassword: "" });
      await nav.reloadSite();
      const comp =
        r.competitors.source === "ficha" ? "competidores tomados de tu ficha de marca"
          : r.competitors.source === "google" ? (r.competitors.count ? `${r.competitors.count} competidores encontrados en Google` : "sin competidores claros en Google")
            : "competidores sin rellenar (faltan los datos de Google)";
      setAMsg(`✓ Rellenado y guardado con ${r.pages.length} ${r.pages.length === 1 ? "página" : "páginas"} de tu web · ${comp}. Revisa los campos y ajusta lo que quieras.`);
    } catch (e: any) {
      setAMsg(e.message);
    } finally {
      setAnalyzing(false);
    }
  };
  const saveBar = (extra?: React.ReactNode) => (
    <div className="flex items-center justify-end gap-3 mt-4 flex-wrap">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      {extra}
      <Btn busy={saving} onClick={save}>Guardar cambios</Btn>
    </div>
  );

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold flex items-center gap-2 flex-1 min-w-0">
          <span className="h-3 w-3 rounded-full shrink-0" style={{ background: site.color }} />
          <span className="truncate">{site.brandName || "Tu web"}</span>
          {site.siteUrl && <span className="text-sm font-normal text-slate-500 truncate">· {site.siteUrl.replace(/^https?:\/\//, "")}</span>}
        </h2>
        <span className={clsx("rounded-full px-2 py-0.5 text-[11px]", site.hasPassword ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{site.hasPassword ? "WordPress conectado" : "WordPress sin conectar"}</span>
        {site.bridgeDetected && <span className="rounded-full px-2 py-0.5 text-[11px] bg-brand-50 text-brand-700">SEO Bridge</span>}
      </div>
      <div className="flex gap-1 border-b mb-4 overflow-x-auto">
        {SUBTABS.map(([k, l]) => (
          <button type="button" key={k} onClick={() => nav.go("web", { sub: k })}
            className={clsx("px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap", sub === k ? "border-brand-500 font-semibold" : "border-transparent text-slate-500")}>{l}</button>
        ))}
      </div>

      {sub === "negocio" && (
        <Card>
          <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50/60 p-3 sm:p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Sparkles className="h-4 w-4 text-brand-600" /> Rellenar con IA desde tu web</div>
            <p className="mt-0.5 text-xs text-slate-600">Escribe la dirección de tu web: la IA lee tus páginas, busca a tu competencia en Google y rellena todos los campos.</p>
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              <input type="url" inputMode="url" value={aUrl} disabled={analyzing} onChange={(e) => setAUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && analyze()}
                placeholder="https://www.tuweb.com" aria-label="Dirección de tu web" className={clsx(inputCls, "flex-1")} />
              <Btn busy={analyzing} disabled={!aUrl.trim()} onClick={analyze} className="justify-center"><Wand2 className="h-4 w-4" /> {analyzing ? "Analizando…" : "Analizar con IA"}</Btn>
            </div>
            {analyzing && <p className="mt-2 text-xs text-brand-700 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" /> Leyendo tu web y analizando el negocio. Puede tardar hasta un minuto.</p>}
            {aMsg && !analyzing && <p role="status" className={clsx("mt-2 text-xs", aMsg.startsWith("✓") ? "text-emerald-700" : "text-rose-600")}>{aMsg}</p>}
          </div>
          <p className="text-xs text-slate-500 mb-4">La IA usa estos datos (y los de tu ficha de marca) para escribir como tu negocio. Cuanto más concretos, mejores artículos.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {txt("sector", "Sector / actividad", { ph: "Ej: clínica dental, reformas, asesoría…" })}
            {txt("location", "Ubicación / zona de servicio", { ph: "Ej: tu ciudad y alrededores" })}
            <Field label="Idioma">
              <select value={form.language} onChange={set("language")} className={inputCls}>
                {[["es-ES", "Español (España)"], ["es-MX", "Español (México)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"], ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["it-IT", "Italiano"], ["pt-PT", "Português"], ["ca-ES", "Català"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            {area("businessInfo", "Datos reales del negocio (servicios, equipo, años, certificaciones, diferenciales…)", { rows: 4, help: "La IA solo afirma datos que estén aquí o en tu ficha de marca. Nunca inventa cifras, premios ni testimonios." })}
            {area("audience", "Público objetivo", { ph: "Quién compra lo que vendes: perfil, necesidades, dudas habituales…" })}
            {txt("tone", "Tono", { ph: "Cercano, experto, tranquilizador. Trato de tú." })}
            {txt("ctaText", "Llamada a la acción", { ph: "Pide tu presupuesto sin compromiso" })}
            {txt("ctaUrl", "URL de la llamada a la acción", { ph: "https://…/contacto/" })}
            {area("brandVoice", "Voz de marca (expresiones propias, cómo habla)")}
            {area("compliance", "Restricciones legales / cumplimiento (obligatorias)", { ph: "Sin promesas de resultados, sin precios promocionales sin condiciones…" })}
            {area("forbidden", "Palabras o temas prohibidos", { rows: 2 })}
            {area("competitors", "Competidores (dominios, uno por línea)", { rows: 2, help: "Nunca se enlazan ni se citan." })}
            <Field label="Color en el calendario"><input type="color" value={form.color ?? "#2563EB"} onChange={set("color")} className="h-9 w-16 rounded border" /></Field>
          </div>
          {saveBar()}
        </Card>
      )}

      {sub === "wp" && <WpTab site={site} form={form} set={set} txt={txt} saveBar={saveBar} onSaved={async () => { await load(); await nav.reloadSite(); }} isAdmin={nav.isAdmin} />}
      {sub === "keywords" && <KeywordsTab siteId={id} onChanged={nav.reloadSite} />}
      {sub === "estilo" && <StyleTab siteId={id} form={form} setForm={setForm} set={set} saveBar={saveBar} onChanged={nav.reloadSite} />}

      {sub === "publicacion" && (
        <Card>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3"><input type="checkbox" className="mt-1" checked={!!form.autoPublish} onChange={set("autoPublish")} />
              <span><b>Publicar sin revisión humana</b><br /><span className="text-xs text-slate-500">El post se programa en tu web en cuanto está redactado. Si está desactivado, queda «En revisión» hasta que alguien lo apruebe.</span></span></label>
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

function WpTab({ site, form, set, txt, saveBar, onSaved, isAdmin }: any) {
  const [testing, setTesting] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const connected = !!site.hasPassword;

  // Mientras se muestra el código, comprobamos cada 5 s si el plugin ya ha conectado
  useEffect(() => {
    if (!code) return;
    const t = setInterval(async () => {
      const s = await api(`/sites/${site.id}`).catch(() => null);
      if (s?.pairedAt && s.pairedAt !== site.pairedAt) {
        setCode("");
        await onSaved();
        setRes(await api(`/sites/${site.id}/test`, { method: "POST" }).catch((e: any) => ({ ok: false, error: e.message })));
      }
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, site.id, site.pairedAt]);

  const getCode = async () => {
    setCodeBusy(true);
    try {
      const r = await api(`/sites/${site.id}/pair-code`, { method: "POST" });
      setCode(r.code);
      try {
        await navigator.clipboard.writeText(r.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {}
    } catch (e: any) {
      setRes({ ok: false, error: e.message });
    } finally {
      setCodeBusy(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      const r = await api(`/sites/${site.id}/test`, { method: "POST" });
      setRes(r);
      if (r?.fixedUrl) await onSaved();
    } catch (e: any) {
      setRes({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Conexión con tu web WordPress">
        <div className={clsx("rounded-lg p-3 text-sm mb-4 border break-words", connected ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800")}>
          {connected ? (
            <>✅ <b>Conectada</b>{site.wpUser ? <> como <b>{site.wpUser}</b></> : null}{site.siteUrl ? <> · {site.siteUrl}</> : null}{site.pairedAt ? <> · desde el {fmtDate(site.pairedAt)}</> : null}{site.pagesIndexed ? <> · {site.pagesIndexed} páginas indexadas</> : null}</>
          ) : (
            <>⚠️ <b>Sin conectar.</b> Sigue los 3 pasos de abajo: no hay que crear usuarios ni contraseñas en WordPress.</>
          )}
        </div>
        {!isAdmin && <p className="mb-4 text-xs text-slate-500">Solo un administrador de tu cuenta puede conectar o cambiar la web. Puedes descargar el plugin y probar la conexión.</p>}
        <ol className="space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="h-6 w-6 shrink-0 rounded-full bg-slate-900 text-white grid place-items-center text-xs font-bold">1</span>
            <div className="min-w-0">
              <div className="font-semibold">Descarga el plugin e instálalo en tu web</div>
              <div className="text-slate-600">En tu WordPress: Plugins → Añadir nuevo → Subir plugin → elige el ZIP → Instalar → Activar.</div>
              <a href="/api/v1/seo-blog/bridge" className="inline-flex items-center gap-1.5 mt-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"><Download className="h-4 w-4" /> Descargar nv-seo-bridge.zip</a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="h-6 w-6 shrink-0 rounded-full bg-slate-900 text-white grid place-items-center text-xs font-bold">2</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">Copia el código de conexión</div>
              <div className="text-slate-600">Es de un solo uso y caduca en 24 h.</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Btn busy={codeBusy} disabled={!isAdmin} onClick={getCode}>{code ? "Generar otro código" : "Copiar código de conexión"}</Btn>
                {copied && <span className="text-xs text-emerald-700 font-medium">Copiado al portapapeles ✓</span>}
              </div>
              {code && (
                <div className="mt-2 flex items-center gap-2">
                  <input readOnly value={code} onFocus={(e) => e.currentTarget.select()} className={clsx(inputCls, "font-mono text-xs")} />
                  <Btn variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {} }}>Copiar</Btn>
                </div>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <span className="h-6 w-6 shrink-0 rounded-full bg-slate-900 text-white grid place-items-center text-xs font-bold">3</span>
            <div className="min-w-0">
              <div className="font-semibold">Pega el código en tu web</div>
              <div className="text-slate-600">En tu WordPress: Ajustes → <b>NV SEO Bridge</b> → pegar → «Conectar con Negocio Vivo». Esta pantalla se actualizará sola en cuanto conecte.</div>
              {code && <div className="mt-1.5 text-xs text-violet-700 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" /> Esperando a que el plugin conecte…</div>}
            </div>
          </li>
        </ol>
        {res && (
          <div className={clsx("mt-4 rounded-lg p-3 text-sm break-words", res.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200")}>
            {res.ok ? (
              <>✅ Conectado como <b>{res.user}</b> (ID {res.userId}) en «{res.siteName}» · {res.pagesFound} páginas/posts indexados para el enlazado interno<br />
                Publicar: {res.canPublish ? "✅" : "❌"} · Subir medios: {res.canUpload ? "✅" : "❌"} · NV SEO Bridge: {res.bridge ? "✅" : "⚠️ no instalado"} · Yoast: {res.yoast ? "✅" : "—"} · Rank Math: {res.rankmath ? "✅" : "—"}</>
            ) : <>❌ {res.error}</>}
            {res.fixedUrl && <div className="mt-1 text-xs">ℹ️ La URL guardada no era la raíz del WordPress; se ha corregido automáticamente a <b>{res.fixedUrl}</b>.</div>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3 justify-between">
          {isAdmin ? <button type="button" onClick={() => setManual(!manual)} className="text-xs text-slate-500 underline">{manual ? "Ocultar conexión manual" : "Conexión manual (avanzado)"}</button> : <span />}
          {(connected || site.siteUrl) && <Btn variant="ghost" busy={testing} onClick={test}>Probar conexión</Btn>}
        </div>
      </Card>
      {manual && isAdmin && (
        <Card title="Conexión manual (avanzado)">
          <p className="text-xs text-slate-500 mb-3">Solo si no puedes instalar el plugin. Necesitas una contraseña de aplicación del usuario (WordPress → Usuarios → Editar usuario → Contraseñas de aplicación).</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {txt("siteUrl", "URL de tu web WordPress", { ph: "https://www.tuweb.com", wide: true })}
            {txt("wpUser", "Usuario WordPress", { help: "Rol Editor o Administrador." })}
            <Field label="Contraseña de aplicación" help="Se guarda cifrada.">
              <input type="password" autoComplete="new-password" value={form.wpAppPassword ?? ""} onChange={set("wpAppPassword")}
                placeholder={site.hasPassword ? "•••••••• (guardada — escribe para cambiarla)" : "xxxx xxxx xxxx xxxx xxxx xxxx"} className={inputCls} />
            </Field>
          </div>
          {saveBar(
            <Btn variant="ghost" busy={testing} onClick={async () => {
              setTesting(true);
              try {
                await api(`/sites/${site.id}`, { method: "PATCH", body: form });
                await onSaved();
                await test();
              } catch (e: any) {
                setRes({ ok: false, error: e.message });
                setTesting(false);
              }
            }}>Guardar y probar conexión</Btn>
          )}
        </Card>
      )}
      <Card title="Opciones de publicación">
        <div className="grid sm:grid-cols-2 gap-4">
          {txt("wpAuthorId", "ID de autor en la web (opcional)", { type: "number", help: "Un autor real con biografía refuerza E-E-A-T. Vacío o 0 = el usuario conectado." })}
          {txt("defaultCategory", "Categoría por defecto (opcional)", { help: "Vacío = la IA propone la categoría (se crea si no existe)." })}
        </div>
        {saveBar()}
      </Card>
    </div>
  );
}

function KeywordsTab({ siteId, onChanged }: { siteId: string; onChanged: () => Promise<void> }) {
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
    setMsg("");
    try {
      const r = await api(`/sites/${siteId}/keywords`, { method: "POST", body });
      setItems(r.items);
      onChanged().catch(() => null);
      return r.added as number;
    } catch (e: any) {
      setMsg(e.message);
      return 0;
    }
  };
  const patch = async (id: string, body: any) => {
    try {
      await api(`/keywords/${id}`, { method: "PATCH", body });
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  const addOne = () => kw.trim() && add({ keyword: kw, priority: prio, volume: vol }).then(() => { setKw(""); setVol(""); });
  return (
    <Card
      title={`Palabras clave (${items.length})`}
      actions={
        <Btn variant="ghost" size="sm" busy={busy === "sugg"} onClick={async () => {
          setBusy("sugg");
          setMsg("");
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
        <input value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()}
          placeholder="Nueva palabra clave (p. ej. servicio + ciudad)" className={inputCls + " flex-[2] min-w-[220px]"} />
        <select value={prio} onChange={(e) => setPrio(e.target.value)} className={inputCls + " w-40"}><option value="1">Prioridad alta</option><option value="2">Prioridad media</option><option value="3">Prioridad baja</option></select>
        <input type="number" value={vol} onChange={(e) => setVol(e.target.value)} placeholder="Volumen (opc.)" className={inputCls + " w-36"} />
        <Btn onClick={addOne}>Añadir</Btn>
        <Btn variant="ghost" onClick={() => setBulk("")}>Añadir en bloque</Btn>
      </div>
      {msg && <p className="text-xs text-rose-600 mb-2">{msg}</p>}
      {items.length === 0 ? (
        <Empty>Añade las palabras clave por las que quieres aparecer en Google. Consejo: mezcla términos de servicio + localidad y búsquedas largas informativas.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-left text-[11px] uppercase text-slate-500 border-b">
              <th className="py-2 pr-2">Palabra clave</th><th className="pr-2">Tipo</th><th className="pr-2">Intención</th><th className="pr-2">Prioridad</th><th className="pr-2">Volumen</th><th className="pr-2">Preguntas de Google</th><th /></tr></thead>
            <tbody>
              {items.map((k) => (
                <tr key={k.id} className="border-b last:border-0 align-middle">
                  <td className="py-1.5 pr-2"><input defaultValue={k.keyword} onBlur={(e) => e.target.value.trim() && e.target.value !== k.keyword && patch(k.id, { keyword: e.target.value })} className="w-full px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-brand-400 outline-none" /></td>
                  <td className="pr-2"><select defaultValue={k.kwType} onChange={(e) => patch(k.id, { kwType: e.target.value })} className="px-1 py-1 rounded border-transparent bg-transparent">{["principal", "secundaria", "longtail"].map((o) => <option key={o}>{o}</option>)}</select></td>
                  <td className="pr-2"><select defaultValue={k.intent} onChange={(e) => patch(k.id, { intent: e.target.value })} className="px-1 py-1 rounded bg-transparent"><option value="">—</option>{["informacional", "comercial", "transaccional", "local", "navegacional"].map((o) => <option key={o}>{o}</option>)}</select></td>
                  <td className="pr-2"><select defaultValue={String(k.priority)} onChange={(e) => patch(k.id, { priority: e.target.value })} className="px-1 py-1 rounded bg-transparent"><option value="1">Alta</option><option value="2">Media</option><option value="3">Baja</option></select></td>
                  <td className="pr-2"><input type="number" defaultValue={k.volume ?? ""} onBlur={(e) => patch(k.id, { volume: e.target.value })} className="w-20 px-2 py-1 rounded border border-transparent hover:border-slate-200" /></td>
                  <td className="pr-2 max-w-[340px]">{(k.paa ?? []).slice(0, 3).map((q: string) => <span key={q} className="inline-block m-0.5 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-900">{q}</span>)}{!(k.paa ?? []).length && <span className="text-[11px] text-slate-400">Se obtienen al generar propuestas</span>}</td>
                  <td><button type="button" className="text-slate-400 hover:text-rose-600" title="Eliminar" aria-label="Eliminar" onClick={async () => { if (!confirm("¿Eliminar esta palabra clave?")) return; await api(`/keywords/${k.id}`, { method: "DELETE" }).catch((e) => setMsg(e.message)); load(); onChanged().catch(() => null); }}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={bulk !== null} onClose={() => setBulk(null)} title="Añadir palabras clave en bloque"
        footer={<><Btn variant="ghost" onClick={() => setBulk(null)}>Cancelar</Btn><Btn onClick={async () => { const n = await add({ bulk }); setMsg(`${n} palabras clave añadidas`); setBulk(null); }}>Añadir</Btn></>}>
        <p className="text-xs text-slate-500 mb-2">Una por línea. Opcional: <code>palabra clave | prioridad(1-3) | volumen</code></p>
        <textarea rows={10} value={bulk ?? ""} onChange={(e) => setBulk(e.target.value)} className={inputCls} placeholder={"servicio principal ciudad | 1 | 480\nprecio servicio principal | 1\nopiniones servicio | 2"} />
      </Modal>
      <Modal open={!!sugg} onClose={() => setSugg(null)} title="Sugerencias de palabras clave" size="lg"
        footer={<><Btn variant="ghost" onClick={() => setSugg(null)}>Cancelar</Btn><Btn disabled={!picked.size} onClick={async () => { const n = await add({ items: (sugg ?? []).filter((_, i) => picked.has(i)) }); setMsg(`${n} añadidas`); setSugg(null); }}>Añadir seleccionadas</Btn></>}>
        <div className="space-y-2">
          {(sugg ?? []).map((k, i) => (
            <label key={i} className="flex gap-2 items-start text-sm">
              <input type="checkbox" className="mt-1" checked={picked.has(i)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
              <span><b>{k.keyword}</b> <span className="text-xs text-slate-500">{k.kw_type} · {k.intent} · P{k.priority}</span><br /><span className="text-xs text-slate-500">{k.why}</span></span>
            </label>
          ))}
          {!(sugg ?? []).length && <p className="text-sm text-slate-500">La IA no ha encontrado palabras clave nuevas que no tengas ya.</p>}
        </div>
      </Modal>
    </Card>
  );
}

function StyleTab({ siteId, form, setForm, set, saveBar, onChanged }: any) {
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
    if (!files.length) return;
    setUploading(true);
    setMsg("");
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const d = await api(`/sites/${siteId}/refs`, { method: "POST", body: fd });
        setRefs(d.items);
      }
      onChanged?.().catch(() => null);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="space-y-4">
      <Card title={`Imágenes de referencia (${refs.length})`} actions={
        <Btn variant="ghost" size="sm" busy={importing} onClick={async () => {
          setImporting(true);
          setMsg("");
          try {
            const r = await api(`/sites/${siteId}/refs/import-editorial`, { method: "POST" });
            setMsg(r.message || (r.found ? `${r.imported} de ${r.found} imágenes importadas del Editorial` : "Tu marca no tiene imágenes en el Editorial"));
            await load();
            onChanged?.().catch(() => null);
          } catch (e: any) {
            setMsg(e.message);
          } finally {
            setImporting(false);
          }
        }}><Download className="h-3.5 w-3.5" /> Importar del Editorial</Btn>
      }>
        {!storage && <p className="text-sm text-rose-600 mb-2">El almacenamiento de archivos no está disponible: no se pueden subir referencias. Avisa a Negocio Vivo.</p>}
        <p className="text-xs text-slate-500 mb-3">La IA toma de aquí la paleta, la luz, el encuadre y el ambiente. Se usan hasta 5 referencias en cada imagen generada.</p>
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"))); }}
          className={clsx("rounded-xl border-2 border-dashed p-6 text-center text-sm cursor-pointer transition", over ? "border-brand-400 bg-brand-50" : "border-slate-200 bg-slate-50/60", uploading && "opacity-50 pointer-events-none")}
        >
          <Upload className="h-5 w-5 mx-auto text-slate-400" />
          <div className="mt-1">{uploading ? "Subiendo…" : <>Arrastra imágenes aquí o <u>toca para subir</u></>}</div>
          <div className="text-xs text-slate-500">JPG, PNG o WEBP · mín. 256 px · fotos reales de tu marca, de tu web o redes</div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload(Array.from(e.target.files ?? []))} />
        </div>
        {msg && <p className="text-xs text-slate-600 mt-2">{msg}</p>}
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2 mt-4">
          {refs.map((r) => (
            <figure key={r.id} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt="" className="h-full w-full object-cover" />
              <button type="button" aria-label="Eliminar referencia" onClick={async () => { if (!confirm("¿Eliminar referencia?")) return; await api(`/refs/${r.id}`, { method: "DELETE" }).catch((e) => setMsg(e.message)); load(); onChanged?.().catch(() => null); }}
                className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/60 text-white text-sm sm:opacity-0 sm:group-hover:opacity-100">×</button>
            </figure>
          ))}
        </div>
      </Card>
      <Card title="Guía de estilo visual" actions={
        <Btn variant="ghost" size="sm" busy={analyzing} disabled={!refs.length} onClick={async () => {
          setAnalyzing(true);
          setMsg("");
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
          <Field label="Descripción del estilo (en inglés, se envía al generador de imágenes)" help="Se rellena al analizar las referencias. Puedes editarla." wide>
            <textarea rows={5} value={form.visualStyle ?? ""} onChange={set("visualStyle")} className={inputCls} />
          </Field>
          <Field label="Indicaciones adicionales" wide>
            <textarea rows={2} value={form.visualNotes ?? ""} onChange={set("visualNotes")} className={inputCls} placeholder="Ej: natural light, real customers using the product, warm tones…" />
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
            <div className="flex gap-1 mt-2 flex-wrap">{(summary.palette ?? []).map((h: string) => <span key={h} title={h} className="h-6 w-6 rounded border" style={{ background: h }} />)}</div>
            <p className="text-xs mt-2">Pulsa «Guardar cambios» si editas la descripción (el análisis ya la ha guardado).</p>
          </div>
        )}
        {saveBar()}
      </Card>
    </div>
  );
}
