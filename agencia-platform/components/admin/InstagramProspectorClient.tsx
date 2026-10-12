"use client";

import { useMemo, useState } from "react";
import { Copy, Download, Filter, Instagram, Play, RotateCcw, Search, ShieldCheck, Target } from "lucide-react";

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
};

const sampleLeads: Lead[] = [
  { name: "Marta Ruiz", handle: "@martafoodlab", email: "hola@martafoodlab.es", phone: "+34 611 204 881", website: "martafoodlab.es", city: "Madrid", source: "@madridfoodies", tag: "Food creator", score: 92, status: "Listo para email" },
  { name: "Bistro Norte", handle: "@bistronorte", email: "reservas@bistronorte.com", phone: "+34 910 118 407", website: "bistronorte.com", city: "Madrid", source: "@madridfoodies", tag: "Restaurante", score: 88, status: "Validar dominio" },
  { name: "Clara Medina", handle: "@claraenruta", email: "collabs@claraenruta.com", phone: "", website: "claraenruta.com", city: "Valencia", source: "#foodiees", tag: "Influencer", score: 81, status: "Listo para email" },
  { name: "Taco Alto", handle: "@tacoalto.es", email: "eventos@tacoalto.es", phone: "+34 633 520 119", website: "tacoalto.es", city: "Madrid", source: "@madridfoodies", tag: "Cadena local", score: 94, status: "Alta prioridad" },
  { name: "Sergio Fotos Gastro", handle: "@sergiogastroshot", email: "sergio@gastroshot.studio", phone: "", website: "gastroshot.studio", city: "Madrid", source: "post likes", tag: "Fotografia", score: 76, status: "Revisar encaje" },
  { name: "Dulce Patio", handle: "@dulcepatio", email: "pedidos@dulcepatio.es", phone: "+34 622 410 073", website: "", city: "Alcobendas", source: "@madridfoodies", tag: "Pasteleria", score: 85, status: "Listo para email" }
];

const sourceLabels: Record<SourceType, string> = {
  followers: "Seguidores",
  likers: "Likes",
  comments: "Comentarios",
  hashtag: "Hashtag",
  location: "Ubicacion"
};

export default function InstagramProspectorClient() {
  const [campaign, setCampaign] = useState("Restaurantes Madrid - influencers food");
  const [sourceType, setSourceType] = useState<SourceType>("followers");
  const [target, setTarget] = useState("@madridfoodies");
  const [limit, setLimit] = useState(250);
  const [country, setCountry] = useState("Espana");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Listo");
  const [query, setQuery] = useState("");
  const [minScore, setMinScore] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      const haystack = `${lead.name} ${lead.handle} ${lead.email} ${lead.phone} ${lead.city} ${lead.tag} ${lead.status}`.toLowerCase();
      return haystack.includes(q) && lead.score >= minScore;
    });
  }, [leads, minScore, query]);

  const metrics = useMemo(() => {
    const email = leads.filter((lead) => lead.email).length;
    const phone = leads.filter((lead) => lead.phone).length;
    const score = leads.length ? Math.round(leads.reduce((sum, lead) => sum + lead.score, 0) / leads.length) : 0;
    return { total: leads.length, email, phone, score };
  }, [leads]);

  function scan() {
    if (running) return;
    setRunning(true);
    setLeads([]);
    setStatus("Escaneando perfiles");
    sampleLeads.forEach((lead, index) => {
      window.setTimeout(() => {
        setLeads((current) => [...current, { ...lead, source: index < 4 ? target : lead.source }]);
        if (index === 2) setStatus("Enriqueciendo contactos");
        if (index === sampleLeads.length - 1) {
          setStatus("Completado");
          setRunning(false);
        }
      }, 350 + index * 360);
    });
  }

  function reset() {
    setLeads([]);
    setStatus("Listo");
    setQuery("");
    setMinScore(0);
  }

  function csv() {
    const headers = ["nombre", "instagram", "email", "telefono", "web", "ciudad", "origen", "etiqueta", "score", "estado"];
    const rows = filtered.map((lead) => [lead.name, lead.handle, lead.email, lead.phone, lead.website, lead.city, lead.source, lead.tag, lead.score, lead.status]);
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
              Configura audiencias, detecta datos publicos y exporta contactos sin revisar perfiles uno a uno.
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
          <Metric label="Leads encontrados" value={metrics.total} />
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
                Cuenta, post, hashtag o ubicacion
                <input value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" />
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

              <div className="grid gap-3 rounded-xl border bg-slate-50 p-4 md:grid-cols-2">
                {["Email", "Telefono", "Web", "Ubicacion", "Solo perfiles negocio", "Quitar duplicados"].map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300" />
                    {item}
                  </label>
                ))}
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
                {["Definir fuente", "Escanear perfiles", "Enriquecer y puntuar", "Exportar o enviar"].map((step, index) => (
                  <li key={step} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-950 text-xs font-bold text-white">{index + 1}</span>
                    <span><b>{step}</b><small className="block text-slate-500">{index === 0 ? `${sourceLabels[sourceType]} · ${target}` : index === 1 ? `${limit} perfiles maximo` : index === 2 ? `Pais: ${country}` : "CSV para CRM o campana"}</small></span>
                  </li>
                ))}
              </ol>
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
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por nombre, email, ciudad o etiqueta" className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm" />
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
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-slate-500">
                  <th className="py-3">Contacto</th>
                  <th>Datos</th>
                  <th>Origen</th>
                  <th>Score</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length ? filtered.map((lead) => (
                  <tr key={`${lead.handle}-${lead.email}`} className="border-b last:border-0">
                    <td className="py-3"><b>{lead.name}</b><small className="block text-slate-500">{lead.handle}</small></td>
                    <td><b>{lead.email || "Sin email publico"}</b><small className="block text-slate-500">{lead.phone || "Sin telefono publico"} · {lead.website || "Sin web"}</small></td>
                    <td><span className="rounded-full bg-pink-50 px-2 py-1 text-xs font-semibold text-pink-700">{lead.tag}</span><small className="block pt-1 text-slate-500">{lead.city} · {lead.source}</small></td>
                    <td className="font-bold text-emerald-700">{lead.score}</td>
                    <td>{lead.status}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-500">
                      {leads.length ? "No hay leads con esos filtros." : "Configura la audiencia y pulsa Iniciar escaneo."}
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

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <small className="text-slate-500">{label}</small>
      <div className="mt-1 text-2xl font-bold text-slate-950">{value}</div>
    </div>
  );
}
