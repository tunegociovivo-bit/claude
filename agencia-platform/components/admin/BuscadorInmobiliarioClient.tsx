"use client";

import { useEffect, useState, type ReactNode } from "react";
import PageHeader from "@/components/PageHeader";
import clsx from "clsx";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Phone,
  Search,
  Star,
  TrendingUp
} from "lucide-react";
import {
  REQUIRED_SPACES,
  REQUIRED_SPACE_LABELS,
  type Opportunity,
  type RequiredSpace,
  type SearchOperation,
  type SearchResult
} from "@/lib/inmobiliaria/contracts";

type Portal = {
  key: string;
  label: string;
  bank: string;
  url: string;
  note: string | null;
  kind: "generalist" | "bank_asset";
  operations: Array<"rent" | "sale">;
  fetchMode: "verify" | "search_only";
};

const FAVS_KEY = "inmob_favoritos";
type FavItem = { id: string; savedAt: number; o: Opportunity };

function eur(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "Por confirmar";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(n)} €`;
}

function norm(value: string): string {
  return (value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function favId(o: Opportunity): string {
  return o.id || (o.url || "").trim() || o.sources?.find((source) => source.url)?.url ||
    `${o.title}__${o.location}__${o.price}`;
}

function canonicalIdentity(value: string): string {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    });
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return trimmed;
  }
}

function favIdentities(o: Opportunity): Set<string> {
  return new Set([
    o.id,
    o.url,
    ...(o.sources ?? []).map((source) => source.url),
    `${o.title}__${o.location}__${o.price}`
  ].filter(Boolean).map(canonicalIdentity));
}

function favMatches(item: FavItem, opportunity: Opportunity): boolean {
  const saved = favIdentities(item.o);
  saved.add(canonicalIdentity(item.id));
  return [...favIdentities(opportunity)].some((identity) => saved.has(identity));
}

function loadFavs(): FavItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(FAVS_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persistFavs(favs: FavItem[]) {
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify(favs));
  } catch {}
}

function matchesQuery(o: Opportunity, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = norm([
    o.title,
    o.location,
    o.property_type,
    o.portal_label,
    o.bank,
    o.verdict,
    o.operation,
    o.floor,
    o.condition,
    ...(o.pros ?? []),
    ...(o.cons ?? [])
  ].filter(Boolean).join(" "));
  return norm(query).split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

function numeric(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  suffix
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="relative mt-1">
        <input
          type="number"
          min="0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={clsx("w-full px-3 py-2 rounded-lg border text-sm", suffix && "pr-14")}
        />
        {suffix && <span className="absolute right-3 top-2 text-xs text-slate-400">{suffix}</span>}
      </div>
    </label>
  );
}

export default function BuscadorInmobiliarioClient() {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [selectedPortals, setSelectedPortals] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [operation, setOperation] = useState<SearchOperation>("rent");
  const [businessDescription, setBusinessDescription] = useState("");
  const [minSurface, setMinSurface] = useState("");
  const [maxSurface, setMaxSurface] = useState("");
  const [minCabins, setMinCabins] = useState("");
  const [allowOpenPlan, setAllowOpenPlan] = useState(true);
  const [preferStreetLevel, setPreferStreetLevel] = useState(true);
  const [preferSingleFloor, setPreferSingleFloor] = useState(true);
  const [basementPolicy, setBasementPolicy] = useState<"allow_penalize" | "exclude">("allow_penalize");
  const [requiredSpaces, setRequiredSpaces] = useState<RequiredSpace[]>([...REQUIRED_SPACES]);
  const [distributionNotes, setDistributionNotes] = useState("");
  const [maxMonthlyRent, setMaxMonthlyRent] = useState("");
  const [maxPurchasePrice, setMaxPurchasePrice] = useState("");
  const [maxFitOutBudget, setMaxFitOutBudget] = useState("");
  const [maxInitialInvestment, setMaxInitialInvestment] = useState("");
  const [preferReadyToEnter, setPreferReadyToEnter] = useState(true);
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [view, setView] = useState<"results" | "favs">("results");
  const [favs, setFavs] = useState<FavItem[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setFavs(loadFavs());
    fetch("/api/v1/admin/buscador-inmobiliario")
      .then((response) => (response.ok ? response.json() : { portals: [] }))
      .then((data) => {
        const available = (data.portals ?? []) as Portal[];
        setPortals(available);
        setSelectedPortals(available.map((portal) => portal.key));
      })
      .catch(() => {});
  }, []);

  function toggleFav(opportunity: Opportunity) {
    setFavs((previous) => {
      const id = favId(opportunity);
      const next = previous.some((item) => favMatches(item, opportunity))
        ? previous.filter((item) => !favMatches(item, opportunity))
        : [{ id, savedAt: Date.now(), o: opportunity }, ...previous];
      persistFavs(next);
      return next;
    });
  }

  function toggleSpace(space: RequiredSpace) {
    setRequiredSpaces((previous) =>
      previous.includes(space) ? previous.filter((item) => item !== space) : [...previous, space]
    );
  }

  async function runSearch() {
    if (!location.trim() || busy) return;
    const min = numeric(minSurface);
    const max = numeric(maxSurface);
    if (min !== undefined && max !== undefined && min > max) {
      setError("La superficie máxima debe ser igual o mayor que la mínima.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setView("results");
    try {
      const response = await fetch("/api/v1/admin/buscador-inmobiliario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: location.trim(),
          operation,
          businessDescription: businessDescription.trim() || undefined,
          minSurface: min,
          maxSurface: max,
          minCabins: numeric(minCabins) ?? 0,
          allowOpenPlan,
          preferStreetLevel,
          preferSingleFloor,
          basementPolicy,
          requiredSpaces,
          distributionNotes: distributionNotes.trim() || undefined,
          maxMonthlyRent: operation !== "sale" ? numeric(maxMonthlyRent) : undefined,
          maxPurchasePrice: operation !== "rent" ? numeric(maxPurchasePrice) : undefined,
          maxFitOutBudget: numeric(maxFitOutBudget),
          maxInitialInvestment: numeric(maxInitialInvestment),
          preferReadyToEnter,
          portals: selectedPortals,
          onlyMatches
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message ?? data?.message ?? "Error en la búsqueda");
      }
      setResult(await response.json());
    } catch (caught: any) {
      setError(caught?.message ?? "No se pudo completar la búsqueda");
    } finally {
      setBusy(false);
    }
  }

  const filteredFavs = favs.filter((item) => matchesQuery(item.o, query));
  const filteredResults = result?.opportunities.filter((item) => matchesQuery(item, query)) ?? [];
  const generalist = portals.filter((portal) => portal.kind === "generalist");
  const bankAssets = portals.filter((portal) => portal.kind === "bank_asset");

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Buscador de locales para negocios"
        description="Rastrea portales inmobiliarios en tiempo real y ordena los locales por encaje operativo, coste de adecuación e inversión inicial."
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-5 bg-white rounded-xl border p-5 space-y-5 h-fit">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Negocio y zona</h2>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Zona / ubicación *</span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Ej. Málaga centro, Teatinos, Valencia capital…"
                className="mt-1 w-full px-3 py-2 rounded-lg border text-sm"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["rent", "sale", "both"] as SearchOperation[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOperation(value)}
                  className={clsx(
                    "px-3 py-2 rounded-lg border text-xs font-medium",
                    operation === value ? "bg-brand-600 text-white border-brand-600" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {value === "rent" ? "Alquiler" : value === "sale" ? "Compra" : "Ambos"}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Actividad y necesidades</span>
              <textarea
                value={businessDescription}
                onChange={(event) => setBusinessDescription(event.target.value)}
                rows={3}
                placeholder="Ej. centro de estética con cuatro cabinas; valoro accesibilidad, escaparate y licencia compatible."
                className="mt-1 w-full px-3 py-2 rounded-lg border text-sm resize-y"
              />
            </label>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Superficie y distribución</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <NumberField label="Superficie mín." value={minSurface} onChange={setMinSurface} placeholder="100" suffix="m²" />
              <NumberField label="Superficie máxima" value={maxSurface} onChange={setMaxSurface} placeholder="140" suffix="m²" />
              <NumberField label="Cabinas mínimas" value={minCabins} onChange={setMinCabins} placeholder="4" />
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={allowOpenPlan} onChange={(event) => setAllowOpenPlan(event.target.checked)} className="mt-0.5" />
              <span>
                Acepto un local diáfano
                <span className="block text-[11px] text-slate-400">La IA valorará si se pueden crear las cabinas, aunque no existan todavía.</span>
              </span>
            </label>
            <div>
              <div className="text-xs font-medium text-slate-700">Espacios necesarios</div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {REQUIRED_SPACES.map((space) => (
                  <label key={space} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={requiredSpaces.includes(space)} onChange={() => toggleSpace(space)} />
                    {REQUIRED_SPACE_LABELS[space]}
                  </label>
                ))}
              </div>
            </div>
            <input
              value={distributionNotes}
              onChange={(event) => setDistributionNotes(event.target.value)}
              placeholder="Otras necesidades: accesibilidad, salida de humos, fachada…"
              className="w-full px-3 py-2 rounded-lg border text-sm"
            />
          </section>

          <section className="space-y-3 border-t pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Planta y estado</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Toggle label="Preferir planta calle" checked={preferStreetLevel} onChange={setPreferStreetLevel} />
              <Toggle label="Preferir una sola planta" checked={preferSingleFloor} onChange={setPreferSingleFloor} />
              <Toggle label="Priorizar listo para entrar" checked={preferReadyToEnter} onChange={setPreferReadyToEnter} />
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Sótano</span>
              <select
                value={basementPolicy}
                onChange={(event) => setBasementPolicy(event.target.value as typeof basementPolicy)}
                className="mt-1 w-full px-3 py-2 rounded-lg border text-sm bg-white"
              >
                <option value="allow_penalize">Permitir, pero penalizar riesgo y obra</option>
                <option value="exclude">Excluir si todo el local está en sótano</option>
              </select>
            </label>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Límites económicos</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {operation !== "sale" && <NumberField label="Renta máxima" value={maxMonthlyRent} onChange={setMaxMonthlyRent} placeholder="Sin límite" suffix="€/mes" />}
              {operation !== "rent" && <NumberField label="Compra máxima" value={maxPurchasePrice} onChange={setMaxPurchasePrice} placeholder="Sin límite" suffix="€" />}
              <NumberField label="Obra máxima" value={maxFitOutBudget} onChange={setMaxFitOutBudget} placeholder="Sin límite" suffix="€" />
              <NumberField label="Inversión inicial máx." value={maxInitialInvestment} onChange={setMaxInitialInvestment} placeholder="Sin límite" suffix="€" />
            </div>
            <p className="text-[11px] text-slate-400">Los límites solo descartan un local cuando el anuncio confirma que los supera. Las estimaciones se usan para ordenar.</p>
          </section>

          <section className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Portales configurados</h2>
              <div className="flex gap-2 text-[11px]">
                <button type="button" onClick={() => setSelectedPortals(portals.map((portal) => portal.key))} className="text-brand-700 hover:underline">Todos</button>
                <button type="button" onClick={() => setSelectedPortals([])} className="text-slate-500 hover:underline">Ninguno</button>
              </div>
            </div>
            <PortalGroup title="Generalistas" portals={generalist} selected={selectedPortals} onToggle={(key) => setSelectedPortals((previous) => previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key])} />
            <PortalGroup title="Activos bancarios" portals={bankAssets} selected={selectedPortals} onToggle={(key) => setSelectedPortals((previous) => previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key])} />
          </section>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={onlyMatches} onChange={(event) => setOnlyMatches(event.target.checked)} />
            Ocultar encajes bajos
          </label>
          <button
            onClick={runSearch}
            disabled={busy || !location.trim() || selectedPortals.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {busy ? "Rastreando y comparando…" : "Buscar locales"}
          </button>
          <p className="text-[11px] text-slate-400">La IA rastrea cada portal seleccionado por lotes. Puede tardar varios minutos.</p>
        </div>

        <div className="xl:col-span-7 space-y-4">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
            <TabButton active={view === "results"} onClick={() => setView("results")}>Resultados</TabButton>
            <TabButton active={view === "favs"} onClick={() => setView("favs")}>
              <Star className="h-3.5 w-3.5" fill={favs.length ? "currentColor" : "none"} />
              Favoritos{favs.length ? ` (${favs.length})` : ""}
            </TabButton>
          </div>

          {((view === "favs" && favs.length > 0) || (view === "results" && result?.opportunities.length)) ? (
            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar por calle, zona, portal, planta o estado…" className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm" />
            </div>
          ) : null}

          {view === "favs" ? (
            <FavoriteResults favs={favs} filtered={filteredFavs} query={query} onToggle={toggleFav} />
          ) : (
            <>
              {busy && <StatusCard icon={<Loader2 className="h-5 w-5 animate-spin text-brand-600" />} text="Rastreando portales, comprobando fichas y evaluando el encaje del negocio…" />}
              {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700 flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{error}</div>}
              {!busy && !error && !result && <div className="bg-white rounded-xl border p-10 text-center text-slate-400"><Building2 className="h-10 w-10 mx-auto mb-3 text-slate-300" /><p className="text-sm">Describe el local que necesitas y pulsa <span className="font-medium">Buscar locales</span>.</p></div>}
              {result && <SearchResults result={result} filtered={filteredResults} query={query} favs={favs} onToggle={toggleFav} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function PortalGroup({ title, portals, selected, onToggle }: { title: string; portals: Portal[]; selected: string[]; onToggle: (key: string) => void }) {
  if (!portals.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {portals.map((portal) => (
          <label key={portal.key} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" checked={selected.includes(portal.key)} onChange={() => onToggle(portal.key)} className="mt-0.5" />
            <span><span className="font-medium">{portal.label}</span>{portal.note && <span className="block text-[10px] text-slate-400">{portal.note}</span>}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={clsx("px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5", active ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700")}>{children}</button>;
}

function StatusCard({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-3">{icon}{text}</div>;
}

function FavoriteResults({ favs, filtered, query, onToggle }: { favs: FavItem[]; filtered: FavItem[]; query: string; onToggle: (opportunity: Opportunity) => void }) {
  if (!favs.length) return <div className="bg-white rounded-xl border p-10 text-center text-slate-400"><Star className="h-10 w-10 mx-auto mb-3 text-slate-300" /><p className="text-sm">Aún no has guardado locales favoritos.</p></div>;
  if (!filtered.length) return <div className="bg-white rounded-xl border p-8 text-center text-slate-500 text-sm">Ningún favorito coincide con “{query}”.</div>;
  return <div className="space-y-3">{filtered.map((item) => <OpportunityCard key={item.id} o={item.o} fav onToggleFav={() => onToggle(item.o)} />)}</div>;
}

function SearchResults({ result, filtered, query, favs, onToggle }: { result: SearchResult; filtered: Opportunity[]; query: string; favs: FavItem[]; onToggle: (opportunity: Opportunity) => void }) {
  return (
    <div className="space-y-4">
      {result.summary && <div className="bg-slate-50 border rounded-xl p-4"><div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Resumen del análisis</div><p className="text-sm text-slate-700 whitespace-pre-wrap">{result.summary}</p></div>}
      {result.stats && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[
        ["Candidatos", result.stats.candidatesFound], ["Duplicados", result.stats.duplicatesMerged],
        ["Fuera de límites", result.stats.hardFiltered], ["Mostrados", result.stats.returned]
      ].map(([label, value]) => <div key={String(label)} className="rounded-lg border bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div><div className="text-lg font-semibold text-slate-800">{value}</div></div>)}</div>}
      {result.portalCoverage?.some((item) => item.status === "failed") && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Búsqueda parcial: {result.portalCoverage.filter((item) => item.status === "failed").map((item) => item.label).join(", ")} no pudieron completarse en este rastreo.</div>}
      {!result.opportunities.length ? <div className="bg-white rounded-xl border p-8 text-center text-slate-500 text-sm">No se encontraron locales con encaje suficiente. Los datos desconocidos no se han usado para descartar.{result.notes && <p className="mt-2 text-xs text-slate-400">{result.notes}</p>}</div> : !filtered.length ? <div className="bg-white rounded-xl border p-8 text-center text-slate-500 text-sm">Ningún local coincide con “{query}”.</div> : <div className="space-y-3">{filtered.map((opportunity) => <OpportunityCard key={opportunity.id || `${opportunity.portal}-${opportunity.title}`} o={opportunity} fav={favs.some((item) => favMatches(item, opportunity))} onToggleFav={() => onToggle(opportunity)} />)}</div>}
      {result.notes && result.opportunities.length > 0 && <p className="text-[11px] text-slate-400 px-1">{result.notes}</p>}
    </div>
  );
}

function ScoreBadge({ score, verdict }: { score: number; verdict: string }) {
  const color = verdict === "OPORTUNIDAD" ? "emerald" : verdict === "INTERESANTE" ? "amber" : "rose";
  return <div className={clsx("shrink-0 h-14 w-14 rounded-xl grid place-items-center text-white font-bold", color === "emerald" && "bg-emerald-500", color === "amber" && "bg-amber-500", color === "rose" && "bg-rose-500")}><span className="text-lg leading-none">{score}</span><span className="text-[9px] opacity-80">encaje</span></div>;
}

function OpportunityCard({ o, fav, onToggleFav }: { o: Opportunity; fav?: boolean; onToggleFav?: () => void }) {
  const legacy = !Array.isArray(o.fit_breakdown);
  const verdictLabel = o.verdict === "OPORTUNIDAD" ? "Encaje alto" : o.verdict === "INTERESANTE" ? "Encaje medio" : "Encaje bajo";
  const color = o.verdict === "OPORTUNIDAD" ? "emerald" : o.verdict === "INTERESANTE" ? "amber" : "rose";
  const verifiedDirectLink = legacy || o.url_verified === true;
  const link = verifiedDirectLink ? (o.url || o.searchUrl) : o.searchUrl;
  return (
    <article className="bg-white rounded-xl border p-4">
      <div className="flex items-start gap-4">
        <ScoreBadge score={o.score ?? 0} verdict={o.verdict} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx("text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded", color === "emerald" && "bg-emerald-100 text-emerald-700", color === "amber" && "bg-amber-100 text-amber-700", color === "rose" && "bg-rose-100 text-rose-700")}>{verdictLabel}</span>
            <span className="text-[11px] text-slate-400">{o.portal_label} · {o.bank}</span>
            {onToggleFav && <button type="button" onClick={onToggleFav} className={clsx("ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border", fav ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}><Star className="h-3.5 w-3.5" fill={fav ? "currentColor" : "none"} />{fav ? "Guardado" : "Guardar"}</button>}
          </div>
          {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm font-semibold text-brand-700 hover:underline">{o.title}</a> : <h3 className="mt-1 text-sm font-semibold text-slate-800">{o.title}</h3>}
          <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5 flex-wrap"><MapPin className="h-3 w-3" />{o.location} · {o.property_type}{o.phone && <a href={`tel:${o.phone.replace(/\s+/g, "")}`} className="ml-2 inline-flex items-center gap-1 text-brand-700 hover:underline"><Phone className="h-3 w-3" />{o.phone}</a>}</div>

          {legacy ? <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Análisis guardado con el formato anterior. Precio: {eur(o.price)} · Superficie: {o.surface ? `${o.surface} m²` : "por confirmar"}.</div> : <>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <Metric label="Renta" value={o.monthly_rent ? `${eur(o.monthly_rent)}/mes` : "Por confirmar"} strong={o.operation === "rent"} />
              <Metric label="Compra" value={eur(o.sale_price)} strong={o.operation === "sale"} />
              <Metric label="Superficie" value={o.surface ? `${o.surface} m²` : "Por confirmar"} />
              <Metric label="Cabinas" value={o.cabin_capacity != null ? `Capacidad ${o.cabin_capacity}` : o.existing_cabins != null ? `${o.existing_cabins} existentes` : "Por confirmar"} />
              <Metric label="Planta" value={floorLabel(o.floor)} />
              <Metric label="Distribución" value={layoutLabel(o.layout)} />
              <Metric label="Adecuación" value={o.fit_out_estimate ? `${eur(o.fit_out_estimate.min)}–${eur(o.fit_out_estimate.max)}` : "Por estimar"} />
              <Metric label="Confianza" value={`${o.fit_confidence ?? 0}%`} />
            </div>
            {o.fit_breakdown?.length > 0 && <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">{o.fit_breakdown.map((item) => <div key={item.key} className={clsx("rounded-md border px-2.5 py-2 text-[11px]", item.status === "match" && "border-emerald-200 bg-emerald-50 text-emerald-800", item.status === "mismatch" && "border-rose-200 bg-rose-50 text-rose-700", ["partial", "unknown", "not_applicable"].includes(item.status) && "border-slate-200 bg-slate-50 text-slate-600")}><div className="font-semibold">{item.label} · {item.points}/{item.maxPoints}</div><div>{item.reason}</div></div>)}</div>}
            {o.unknown_fields?.length > 0 && <p className="mt-2 text-[11px] text-amber-700">Por confirmar antes de decidir: {o.unknown_fields.join(", ")}.</p>}
          </>}

          {(o.pros?.length > 0 || o.cons?.length > 0) && <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">{o.pros?.length > 0 && <ul className="space-y-0.5">{o.pros.map((item, index) => <li key={index} className="text-xs text-emerald-700 flex items-start gap-1"><CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />{item}</li>)}</ul>}{o.cons?.length > 0 && <ul className="space-y-0.5">{o.cons.map((item, index) => <li key={index} className="text-xs text-rose-600 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{item}</li>)}</ul>}</div>}
          {o.reasoning && <p className="mt-2 text-xs text-slate-600 leading-relaxed flex items-start gap-1"><TrendingUp className="h-3 w-3 mt-0.5 shrink-0 text-slate-400" />{o.reasoning}</p>}
          <div className="mt-3 flex items-center gap-3 flex-wrap">{link ? <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium">{verifiedDirectLink && o.url ? "Ver oferta" : "Buscar en el portal"}<ExternalLink className="h-3 w-3" /></a> : <span className="text-xs text-slate-400">Sin enlace disponible</span>}{!legacy && o.url && !o.url_verified && <span className="text-[11px] text-amber-700">Ficha directa sin verificar</span>}{o.sources?.length > 1 && <span className="text-[11px] text-slate-500">Publicado en {o.sources.length} fuentes</span>}</div>
        </div>
      </div>
    </article>
  );
}

function floorLabel(value: Opportunity["floor"] | undefined): string {
  return ({ street: "Planta calle", basement: "Sótano", mezzanine: "Entreplanta", upper: "Planta alta", mixed: "Varias plantas", unknown: "Por confirmar" } as const)[value ?? "unknown"];
}

function layoutLabel(value: Opportunity["layout"] | undefined): string {
  return ({ open_plan: "Diáfano", partitioned: "Compartimentado", mixed: "Mixto", unknown: "Por confirmar" } as const)[value ?? "unknown"];
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div><div className={clsx("font-medium text-slate-700", strong && "text-sm text-slate-900")}>{value}</div></div>;
}
