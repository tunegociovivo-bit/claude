"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Filter, Instagram, Play, RotateCcw, Save, Search, ShieldCheck, Target, Trash2 } from "lucide-react";

type SourceType = "followers" | "likers" | "comments" | "hashtag" | "location";

type Lead = {
  name: string;
  handle: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  source: string;
  tag: string;
  score: number;
  status: string;
  signals: string[];
  missingSignals: string[];
};

type SearchPreset = {
  id: string;
  name: string;
  description: string;
  campaign: string;
  sourceType: SourceType;
  target: string;
  country: string;
  limit: number;
  minScore: number;
  requiredSignalCount: number;
  requireIntentSignal: boolean;
  emailKeywords: string;
  intentSignals: string;
  negativeFilters: string;
  builtIn?: boolean;
};

const PRESETS_STORAGE_KEY = "nv-instagram-prospector-presets-v1";

const builtInPresets: SearchPreset[] = [
  {
    id: "franchise-supermarkets",
    name: "Potenciales franquiciados - alimentacion",
    description: "Valida perfiles solo cuando combinan interes en alimentacion/retail con senales claras de franquicia, inversion o negocio propio.",
    campaign: "Potenciales franquiciados - alimentacion Espana",
    sourceType: "followers",
    target: "@franquicias_hoy\n@mundofranquicia\n@tormofranquicias\n@barbadilloyasociados\n@franquiciasaldia\n@expofranquicia\n@franquishop\n#franquicias\n#franquicia\n#franquiciasrentables\n#franquiciasespana\n#invertirenfranquicias\n#autoempleo\n#negociopropio\n#retail\n#alimentacion\n#tiendasdealimentacion",
    country: "Espana",
    limit: 1000,
    minScore: 70,
    requiredSignalCount: 3,
    requireIntentSignal: true,
    emailKeywords: "eroski\ncarrefour\ndia\ncoviran\nalcampo\nconsum\nbonarea",
    intentSignals: "comenta sobre franquicias\nusa hashtag franquicias\npide info de inversion\nbio emprendedor o inversor\nsigue portales de franquicias\ninteractua con alimentacion retail\ntiene contacto publico\nubicacion objetivo",
    negativeFilters: "solo sigue supermercados de consumo\nofertas y cupones\nrecetas\nsorteos\ncliente habitual sin bio profesional\nperfil privado\nsin actividad reciente\nmenor de edad",
    builtIn: true
  }
];

const sampleLeads: Lead[] = [
  { name: "Rafael Molina", handle: "@rafa.inversiones", email: "rafael@molinaretail.es", phone: "+34 611 204 881", website: "molinaretail.es", city: "Madrid", source: "#invertirenfranquicias", tag: "Inversor retail", score: 92, status: "Valido", signals: ["Intencion franquicia", "Retail alimentacion", "Bio inversor", "Contacto publico"], missingSignals: [] },
  { name: "Francisco Delegado", handle: "@fran.delegado", email: "franciscodelegado@eroski.es", phone: "+34 644 908 211", website: "delegadoretail.es", city: "Bilbao", source: "#franquiciasespana", tag: "Retail alimentacion", score: 91, status: "Valido", signals: ["Intencion franquicia", "Retail alimentacion", "Email supermercado", "Contacto publico"], missingSignals: [] },
  { name: "Laura Campos", handle: "@laurac.negocio", email: "laura@camposgestion.com", phone: "", website: "camposgestion.com", city: "Valencia", source: "@mundofranquicia", tag: "Emprendedora", score: 86, status: "Valido", signals: ["Intencion franquicia", "Bio emprendedora", "Sigue portal franquicias"], missingSignals: ["Sin telefono publico"] },
  { name: "Manuel Eroski", handle: "@manuel.negocios", email: "manueleroski@hotmail.com", phone: "", website: "", city: "San Sebastian", source: "@franquiciasaldia", tag: "Interes franquicia", score: 74, status: "Valido", signals: ["Intencion franquicia", "Email supermercado", "Sigue portal franquicias"], missingSignals: ["Sin telefono publico", "Sin web"] },
  { name: "Super Ahorro Fan", handle: "@superahorrofan", email: "", phone: "", website: "", city: "Sevilla", source: "@carrefour_es", tag: "Consumidor", score: 34, status: "Descartado", signals: ["Sigue supermercado"], missingSignals: ["Sin intencion franquicia", "Sin bio profesional", "Sin contacto publico"] },
  { name: "Taco Alto", handle: "@tacoalto.es", email: "eventos@tacoalto.es", phone: "+34 633 520 119", website: "tacoalto.es", city: "Madrid", source: "#negociopropio", tag: "Hosteleria", score: 78, status: "Valido", signals: ["Intencion negocio", "Contacto publico", "Actividad comercial"], missingSignals: ["No confirma alimentacion retail"] },
  { name: "Sergio Fotos Gastro", handle: "@sergiogastroshot", email: "sergio@gastroshot.studio", phone: "", website: "gastroshot.studio", city: "Madrid", source: "post likes", tag: "Proveedor", score: 58, status: "Insuficiente", signals: ["Contacto publico", "Sector food"], missingSignals: ["Sin intencion franquicia"] },
  { name: "Dulce Patio", handle: "@dulcepatio", email: "pedidos@dulcepatio.es", phone: "+34 622 410 073", website: "", city: "Alcobendas", source: "#tiendasdealimentacion", tag: "Negocio local", score: 82, status: "Valido", signals: ["Intencion expansion", "Alimentacion", "Contacto publico"], missingSignals: [] }
];

const sourceLabels: Record<SourceType, string> = {
  followers: "Seguidores",
  likers: "Likes",
  comments: "Comentarios",
  hashtag: "Hashtag",
  location: "Ubicacion"
};

function hasIntentSignal(lead: Lead) {
  return lead.signals.some((signal) => /intencion|franquicia|inversion|negocio|expansion/i.test(signal));
}

function isValidLead(lead: Lead, requiredSignalCount: number, requireIntentSignal: boolean) {
  const enoughSignals = lead.signals.length >= requiredSignalCount;
  const intentOk = !requireIntentSignal || hasIntentSignal(lead);
  return enoughSignals && intentOk;
}

function parseKeywords(value: string) {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getEmailKeywordMatch(email: string, keywords: string[]) {
  const normalizedEmail = email.toLowerCase();
  return keywords.find((keyword) => normalizedEmail.includes(keyword)) || "";
}

function buildDemoLeads(count: number, target: string) {
  const sources = target.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const base = sampleLeads[index % sampleLeads.length];
    const cycle = Math.floor(index / sampleLeads.length);
    const suffix = cycle ? ` ${cycle + 1}` : "";
    const source = sources[index % Math.max(1, sources.length)] || base.source;
    const email = cycle && base.email ? base.email.replace("@", `+${cycle + 1}@`) : base.email;
    return {
      ...base,
      name: `${base.name}${suffix}`,
      handle: cycle ? `${base.handle}${cycle + 1}` : base.handle,
      email,
      source,
      score: Math.max(25, Math.min(99, base.score - (cycle % 4) * 3 + (index % 3) * 2))
    };
  });
}

export default function InstagramProspectorClient() {
  const [campaign, setCampaign] = useState("Restaurantes Madrid - influencers food");
  const [sourceType, setSourceType] = useState<SourceType>("followers");
  const [target, setTarget] = useState("@madridfoodies");
  const [limit, setLimit] = useState(250);
  const [country, setCountry] = useState("Espana");
  const [requiredSignalCount, setRequiredSignalCount] = useState(2);
  const [requireIntentSignal, setRequireIntentSignal] = useState(true);
  const [emailKeywords, setEmailKeywords] = useState("");
  const [intentSignals, setIntentSignals] = useState("email publico\ntelefono publico\nweb activa\nbio profesional\nactividad reciente");
  const [negativeFilters, setNegativeFilters] = useState("perfil privado\nsin datos publicos\nduplicados");
  const [savedPresets, setSavedPresets] = useState<SearchPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Listo");
  const [query, setQuery] = useState("");
  const [minScore, setMinScore] = useState(0);
  const allPresets = useMemo(() => [...builtInPresets, ...savedPresets], [savedPresets]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (raw) setSavedPresets(JSON.parse(raw));
    } catch {
      setSavedPresets([]);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const emailKeywordList = parseKeywords(emailKeywords);
    return leads.filter((lead) => {
      const haystack = `${lead.name} ${lead.handle} ${lead.email} ${lead.phone} ${lead.city} ${lead.tag} ${lead.status} ${lead.signals.join(" ")}`.toLowerCase();
      const emailMatch = !emailKeywordList.length || getEmailKeywordMatch(lead.email, emailKeywordList);
      return haystack.includes(q) && lead.score >= minScore && Boolean(emailMatch) && isValidLead(lead, requiredSignalCount, requireIntentSignal);
    });
  }, [emailKeywords, leads, minScore, query, requiredSignalCount, requireIntentSignal]);

  const metrics = useMemo(() => {
    const valid = leads.filter((lead) => isValidLead(lead, requiredSignalCount, requireIntentSignal));
    const email = valid.filter((lead) => lead.email).length;
    const phone = valid.filter((lead) => lead.phone).length;
    const score = valid.length ? Math.round(valid.reduce((sum, lead) => sum + lead.score, 0) / valid.length) : 0;
    return { total: valid.length, email, phone, score };
  }, [leads, requiredSignalCount, requireIntentSignal]);

  function scan() {
    if (running) return;
    setRunning(true);
    setLeads([]);
    const demoLeads = buildDemoLeads(limit, target);
    setStatus(`Escaneando ${demoLeads.length} perfiles`);
    demoLeads.forEach((lead, index) => {
      window.setTimeout(() => {
        setLeads((current) => [...current, lead]);
        if (index === Math.floor(demoLeads.length / 2)) setStatus("Validando senales cruzadas");
        if (index === demoLeads.length - 1) {
          setStatus("Completado");
          setRunning(false);
        }
      }, 250 + index * 25);
    });
  }

  function reset() {
    setLeads([]);
    setStatus("Listo");
    setQuery("");
    setMinScore(0);
  }

  function applyPreset(preset: SearchPreset) {
    setSelectedPresetId(preset.id);
    setCampaign(preset.campaign);
    setSourceType(preset.sourceType);
    setTarget(preset.target);
    setCountry(preset.country);
    setLimit(preset.limit);
    setMinScore(preset.minScore);
    setRequiredSignalCount(preset.requiredSignalCount);
    setRequireIntentSignal(preset.requireIntentSignal);
    setEmailKeywords(preset.emailKeywords || "");
    setIntentSignals(preset.intentSignals);
    setNegativeFilters(preset.negativeFilters);
    setPresetName(preset.builtIn ? `${preset.name} copia` : preset.name);
    setStatus(`Plantilla aplicada: ${preset.name}`);
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const preset: SearchPreset = {
      id: `custom-${Date.now()}`,
      name,
      description: "Plantilla personalizada",
      campaign,
      sourceType,
      target,
      country,
      limit,
      minScore,
      requiredSignalCount,
      requireIntentSignal,
      emailKeywords,
      intentSignals,
      negativeFilters
    };
    const next = [...savedPresets, preset];
    setSavedPresets(next);
    setSelectedPresetId(preset.id);
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(next));
    setStatus(`Plantilla guardada: ${name}`);
  }

  function deletePreset(id: string) {
    const next = savedPresets.filter((preset) => preset.id !== id);
    setSavedPresets(next);
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(next));
    if (selectedPresetId === id) setSelectedPresetId("");
    setStatus("Plantilla eliminada");
  }

  function csv() {
    const emailKeywordList = parseKeywords(emailKeywords);
    const headers = ["nombre", "instagram", "email", "coincidencia_email", "telefono", "web", "ciudad", "origen", "etiqueta", "score", "estado", "senales", "faltantes"];
    const rows = filtered.map((lead) => [lead.name, lead.handle, lead.email, getEmailKeywordMatch(lead.email, emailKeywordList), lead.phone, lead.website, lead.city, lead.source, lead.tag, lead.score, lead.status, lead.signals.join(" | "), lead.missingSignals.join(" | ")]);
    return [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  }

  async function copyCsv() {
    if (!filtered.length) return;
    await navigator.clipboard.writeText(csv());
  }

  function exportCsv() {
    if (!filtered.length) return;
    const blob = new Blob([csv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `instagram-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-pink-100 px-3 py-1 text-xs font-semibold text-pink-700">
              <Instagram className="h-4 w-4" />
              Prospector IG
            </div>
            <h1 className="text-3xl font-bold text-slate-950">Captacion desde Instagram</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Configura audiencias, exige varias senales de intencion y exporta contactos sin revisar perfiles uno a uno.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={reset} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold">
              <RotateCcw className="h-4 w-4" />
              Limpiar
            </button>
            <button onClick={scan} disabled={running} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Play className="h-4 w-4" />
              {running ? "Escaneando..." : "Iniciar escaneo"}
            </button>
          </div>
        </header>

        <section className="mb-5 grid gap-3 md:grid-cols-4">
          <Metric label="Leads validos" value={metrics.total} />
          <Metric label="Con email" value={metrics.email} />
          <Metric label="Con telefono" value={metrics.phone} />
          <Metric label="Calidad media" value={metrics.score || "--"} />
        </section>

        <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
          <section className="rounded-2xl border bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-pink-700">Nueva busqueda</p>
                <h2 className="text-xl font-bold">Configura tu audiencia</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{status}</span>
            </div>

            <div className="mt-5 grid gap-4">
              <section className="rounded-xl border border-pink-200 bg-pink-50 p-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-pink-700">Plantillas</p>
                    <h3 className="font-bold text-slate-950">Acelera busquedas repetibles</h3>
                    <p className="mt-1 text-xs text-pink-900">
                      Usa una plantilla con reglas cruzadas o guarda tus propias combinaciones de cuentas, senales y filtros.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={selectedPresetId}
                      onChange={(e) => {
                        setSelectedPresetId(e.target.value);
                        const preset = allPresets.find((item) => item.id === e.target.value);
                        if (preset) applyPreset(preset);
                      }}
                      className="rounded-xl border bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Elegir plantilla</option>
                      {allPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                    {selectedPresetId.startsWith("custom-") && (
                      <button onClick={() => deletePreset(selectedPresetId)} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700" type="button">
                        <Trash2 className="h-4 w-4" />
                        Borrar
                      </button>
                    )}
                  </div>
                </div>
                {selectedPresetId && (
                  <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs text-pink-950">
                    {allPresets.find((preset) => preset.id === selectedPresetId)?.description}
                  </p>
                )}
                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                  <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Nombre para guardar esta plantilla" className="rounded-xl border bg-white px-3 py-2 text-sm" />
                  <button onClick={savePreset} disabled={!presetName.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-pink-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" type="button">
                    <Save className="h-4 w-4" />
                    Guardar plantilla
                  </button>
                </div>
              </section>

              <label className="block text-sm font-medium text-slate-700">
                Nombre de campana
                <input value={campaign} onChange={(e) => setCampaign(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" />
              </label>

              <fieldset>
                <legend className="mb-2 text-sm font-bold text-slate-800">Fuente</legend>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(sourceLabels) as SourceType[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSourceType(key)}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold ${sourceType === key ? "border-pink-300 bg-pink-50 text-pink-800" : "bg-white text-slate-700"}`}
                    >
                      {sourceLabels[key]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block text-sm font-medium text-slate-700">
                Cuentas, posts, hashtags o ubicaciones
                <textarea value={target} onChange={(e) => setTarget(e.target.value)} rows={5} className="mt-1 w-full rounded-xl border px-3 py-2" />
                <small className="mt-1 block text-xs text-slate-500">Una fuente por linea. Evita depender solo de cuentas de consumo: combina portales de franquicia, hashtags de inversion y fuentes de alimentacion.</small>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Limite de perfiles
                  <input type="number" min={25} max={10000} step={25} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="mt-1 w-full rounded-xl border px-3 py-2" />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Pais objetivo
                  <select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2">
                    <option>Espana</option>
                    <option>Mexico</option>
                    <option>Colombia</option>
                    <option>Estados Unidos</option>
                    <option>Global</option>
                  </select>
                </label>
              </div>

              <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Reglas de validacion</p>
                  <h3 className="font-bold text-slate-950">Exigir varias senales antes de aceptar un perfil</h3>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Minimo de senales requeridas
                    <input type="number" min={1} max={6} value={requiredSignalCount} onChange={(e) => setRequiredSignalCount(Number(e.target.value))} className="mt-1 w-full rounded-xl border px-3 py-2" />
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={requireIntentSignal} onChange={(e) => setRequireIntentSignal(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                    Requerir senal de intencion franquicia/inversion
                  </label>
                </div>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Email contiene
                  <textarea value={emailKeywords} onChange={(e) => setEmailKeywords(e.target.value)} rows={3} placeholder={"eroski\ncarrefour\ncoviran"} className="mt-1 w-full rounded-xl border bg-white px-3 py-2" />
                  <small className="mt-1 block text-xs text-slate-500">Una palabra por linea o separadas por comas. Busca coincidencias en todo el correo, incluido el dominio.</small>
                </label>
              </section>

              <div className="grid gap-3 rounded-xl border bg-slate-50 p-4 md:grid-cols-2">
                {["Email", "Telefono", "Web", "Ubicacion", "Solo perfiles negocio", "Quitar duplicados"].map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300" />
                    {item}
                  </label>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Senales positivas
                  <textarea value={intentSignals} onChange={(e) => setIntentSignals(e.target.value)} rows={7} className="mt-1 w-full rounded-xl border px-3 py-2" />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Filtros negativos
                  <textarea value={negativeFilters} onChange={(e) => setNegativeFilters(e.target.value)} rows={7} className="mt-1 w-full rounded-xl border px-3 py-2" />
                </label>
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-2xl border bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <Target className="h-5 w-5 text-pink-700" />
                <h2 className="text-xl font-bold">Flujo operativo</h2>
              </div>
              <ol className="space-y-3 text-sm">
                {["Definir fuentes", "Escanear perfiles", "Validar senales cruzadas", "Exportar o enviar"].map((step, index) => (
                  <li key={step} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-950 text-xs font-bold text-white">{index + 1}</span>
                    <span><b>{step}</b><small className="block text-slate-500">{index === 0 ? `${sourceLabels[sourceType]} - ${target.split(/\r?\n/).filter(Boolean).length} fuentes` : index === 1 ? `${limit} perfiles maximo` : index === 2 ? `${requiredSignalCount}+ senales${requireIntentSignal ? " con intencion obligatoria" : ""}${parseKeywords(emailKeywords).length ? `, email: ${parseKeywords(emailKeywords).join(", ")}` : ""}` : "CSV para CRM o campana"}</small></span>
                  </li>
                ))}
              </ol>
            </section>
            <section className="rounded-2xl border bg-white p-5">
              <h2 className="text-xl font-bold">Criterio de scoring</h2>
              <div className="mt-3 grid gap-3 text-sm">
                <SignalList title="Sube score si aparece" value={intentSignals} tone="good" />
                <SignalList title="Descarta o baja score si aparece" value={negativeFilters} tone="bad" />
              </div>
            </section>
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
              <div className="flex items-center gap-2 font-bold">
                <ShieldCheck className="h-5 w-5" />
                Cumplimiento
              </div>
              <p className="mt-2 text-emerald-900">
                Esta version deja aislado el conector real. La integracion final debe usar fuentes permitidas, datos publicos, control de bajas y revision RGPD antes del envio.
              </p>
            </section>
          </aside>
        </div>

        <section className="mt-5 rounded-2xl border bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-pink-700">Resultados</p>
              <h2 className="text-xl font-bold">Leads cualificados</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={copyCsv} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold">
                <Copy className="h-4 w-4" />
                Copiar
              </button>
              <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
                <Download className="h-4 w-4" />
                Exportar CSV
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <label className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por nombre, email, ciudad o senal" className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm" />
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium">
              <Filter className="h-4 w-4" />
              <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="bg-transparent">
                <option value={0}>Todos los scores</option>
                <option value={70}>Score 70+</option>
                <option value={80}>Score 80+</option>
                <option value={90}>Score 90+</option>
              </select>
            </label>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-slate-500">
                  <th className="py-3">Contacto</th>
                  <th>Datos</th>
                  <th>Origen</th>
                  <th>Score</th>
                  <th>Validacion</th>
                  <th>Motivos</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length ? filtered.map((lead) => (
                  <tr key={`${lead.handle}-${lead.email}`} className="border-b last:border-0">
                    <td className="py-3"><b>{lead.name}</b><small className="block text-slate-500">{lead.handle}</small></td>
                    <td>
                      <b>{lead.email || "Sin email publico"}</b>
                      <EmailMatchBadge email={lead.email} emailKeywords={emailKeywords} />
                      <small className="block text-slate-500">{lead.phone || "Sin telefono publico"} - {lead.website || "Sin web"}</small>
                    </td>
                    <td><span className="rounded-full bg-pink-50 px-2 py-1 text-xs font-semibold text-pink-700">{lead.tag}</span><small className="block pt-1 text-slate-500">{lead.city} - {lead.source}</small></td>
                    <td className="font-bold text-emerald-700">{lead.score}</td>
                    <td><ValidationBadge lead={lead} requiredSignalCount={requiredSignalCount} requireIntentSignal={requireIntentSignal} /></td>
                    <td><LeadReasons lead={lead} /></td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      {leads.length ? "No hay leads que cumplan esas reglas." : "Configura la audiencia y pulsa Iniciar escaneo."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function LeadReasons({ lead }: { lead: Lead }) {
  return (
    <div className="max-w-md space-y-1">
      <div className="flex flex-wrap gap-1">
        {lead.signals.map((signal) => (
          <span key={signal} className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{signal}</span>
        ))}
      </div>
      {lead.missingSignals.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {lead.missingSignals.map((signal) => (
            <span key={signal} className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">{signal}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function SignalList({ title, value, tone }: { title: string; value: string; tone: "good" | "bad" }) {
  const items = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className={`rounded-full px-2 py-1 text-xs font-semibold ${tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ValidationBadge({ lead, requiredSignalCount, requireIntentSignal }: { lead: Lead; requiredSignalCount: number; requireIntentSignal: boolean }) {
  const valid = isValidLead(lead, requiredSignalCount, requireIntentSignal);
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${valid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
      {valid ? "Valido" : "No pasa reglas"}
    </span>
  );
}

function EmailMatchBadge({ email, emailKeywords }: { email: string; emailKeywords: string }) {
  const match = getEmailKeywordMatch(email, parseKeywords(emailKeywords));
  if (!match) return null;
  return <small className="mt-1 block font-semibold text-pink-700">Email contiene: {match}</small>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <small className="text-slate-500">{label}</small>
      <div className="mt-1 text-2xl font-bold text-slate-950">{value}</div>
    </div>
  );
}
