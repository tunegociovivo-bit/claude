"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import clsx from "clsx";
import {
  Building2,
  Loader2,
  Search,
  ExternalLink,
  MapPin,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Star
} from "lucide-react";

type Portal = { key: string; label: string; bank: string; url: string; note: string | null };

type Opportunity = {
  portal: string;
  portal_label: string;
  bank: string;
  title: string;
  property_type: string;
  location: string;
  url: string;
  price: number;
  surface: number | null;
  price_m2: number | null;
  estimated_market_price: number | null;
  discount_pct: number | null;
  estimated_rent: number | null;
  gross_yield: number | null;
  score: number;
  verdict: "OPORTUNIDAD" | "INTERESANTE" | "DESCARTAR";
  occupied: boolean;
  pros: string[];
  cons: string[];
  reasoning: string;
};

type SearchResult = {
  opportunities: Opportunity[];
  summary: string;
  notes?: string;
  searchedPortals: { key: string; label: string; bank: string }[];
};

const PROPERTY_TYPES = ["Cualquiera", "Piso", "Casa / Chalet", "Ático", "Local", "Garaje", "Suelo"];
const OBJECTIVES = ["Alquiler", "Reventa", "Vivienda habitual"];

type Occupancy = "any" | "free" | "occupied";
const OCCUPANCY_OPTIONS: { id: Occupancy; label: string; hint: string }[] = [
  { id: "any", label: "Indiferente", hint: "Libres y ocupadas" },
  { id: "free", label: "Libre", hint: "Posesión inmediata" },
  { id: "occupied", label: "Con okupas", hint: "Ocupada · más descuento, más riesgo" }
];

function eur(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(n) + " €";
}

function verdictColor(v: string): string {
  if (v === "OPORTUNIDAD") return "emerald";
  if (v === "INTERESANTE") return "amber";
  return "rose";
}

// ── Favoritos (persistidos en el navegador) ──────────────────────────────
const FAVS_KEY = "inmob_favoritos";
type FavItem = { id: string; savedAt: number; o: Opportunity };

function favId(o: Opportunity): string {
  return (o.url || "").trim() || `${o.title}__${o.location}__${o.price}`;
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

function ScoreBadge({ score, verdict }: { score: number; verdict: string }) {
  const c = verdictColor(verdict);
  return (
    <div
      className={clsx(
        "shrink-0 h-14 w-14 rounded-xl grid place-items-center text-white font-bold",
        c === "emerald" && "bg-emerald-500",
        c === "amber" && "bg-amber-500",
        c === "rose" && "bg-rose-500"
      )}
    >
      <span className="text-lg leading-none">{score}</span>
      <span className="text-[9px] opacity-80">/100</span>
    </div>
  );
}

export default function BuscadorInmobiliarioClient() {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [selectedPortals, setSelectedPortals] = useState<string[]>([]);

  const [location, setLocation] = useState("");
  const [propertyType, setPropertyType] = useState(PROPERTY_TYPES[0]);
  const [objective, setObjective] = useState(OBJECTIVES[0]);
  const [occupancy, setOccupancy] = useState<Occupancy>("any");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minSurface, setMinSurface] = useState("");
  const [onlyOpportunities, setOnlyOpportunities] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  const [view, setView] = useState<"results" | "favs">("results");
  const [favs, setFavs] = useState<FavItem[]>([]);

  useEffect(() => {
    setFavs(loadFavs());
    fetch("/api/v1/admin/buscador-inmobiliario")
      .then((r) => (r.ok ? r.json() : { portals: [] }))
      .then((d) => {
        setPortals(d.portals ?? []);
        setSelectedPortals((d.portals ?? []).map((p: Portal) => p.key));
      })
      .catch(() => {});
  }, []);

  function toggleFav(o: Opportunity) {
    setFavs((prev) => {
      const id = favId(o);
      const exists = prev.some((f) => f.id === id);
      const next = exists
        ? prev.filter((f) => f.id !== id)
        : [{ id, savedAt: Date.now(), o }, ...prev];
      persistFavs(next);
      return next;
    });
  }
  const isFav = (o: Opportunity) => favs.some((f) => f.id === favId(o));

  function togglePortal(key: string) {
    setSelectedPortals((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  async function runSearch() {
    if (!location.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/v1/admin/buscador-inmobiliario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: location.trim(),
          propertyType: propertyType === "Cualquiera" ? undefined : propertyType,
          objective,
          occupancy,
          minPrice: minPrice ? Number(minPrice) : undefined,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
          minSurface: minSurface ? Number(minSurface) : undefined,
          portals: selectedPortals,
          onlyOpportunities
        })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? e?.message ?? "Error en la búsqueda");
      }
      setResult(await r.json());
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Buscador Inmobiliario"
        description="Rastrea portales de activos bancarios (Aliseda, Solvia, Gia, Trial3, Ikesa) y deja que la IA detecte las mejores oportunidades de inversión."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Panel de búsqueda */}
        <div className="lg:col-span-4 bg-white rounded-xl border p-5 space-y-4 h-fit">
          <div>
            <label className="text-xs font-medium text-slate-700">Zona / ubicación *</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Ej. Valencia capital, Málaga, Madrid centro…"
              className="mt-1 w-full px-3 py-2 rounded-lg border text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Tipo</label>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border text-sm bg-white"
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Objetivo</label>
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border text-sm bg-white"
              >
                {OBJECTIVES.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Estado de ocupación</label>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {OCCUPANCY_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOccupancy(o.id)}
                  title={o.hint}
                  className={clsx(
                    "px-2 py-1.5 text-xs rounded-md border text-center leading-tight",
                    occupancy === o.id
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {OCCUPANCY_OPTIONS.find((o) => o.id === occupancy)?.hint}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Precio mín. (€)</label>
              <input
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0"
                className="mt-1 w-full px-3 py-2 rounded-lg border text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Precio máx. (€)</label>
              <input
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="Sin límite"
                className="mt-1 w-full px-3 py-2 rounded-lg border text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Superficie mín. (m²)</label>
            <input
              type="number"
              value={minSurface}
              onChange={(e) => setMinSurface(e.target.value)}
              placeholder="Cualquiera"
              className="mt-1 w-full px-3 py-2 rounded-lg border text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Portales</label>
            <div className="mt-2 space-y-1.5">
              {portals.map((p) => (
                <label
                  key={p.key}
                  className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedPortals.includes(p.key)}
                    onChange={() => togglePortal(p.key)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="text-xs text-slate-400"> · {p.bank}</span>
                    {p.note && <span className="block text-[11px] text-slate-400">{p.note}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyOpportunities}
              onChange={(e) => setOnlyOpportunities(e.target.checked)}
            />
            Mostrar solo oportunidades (ocultar descartes)
          </label>

          <button
            onClick={runSearch}
            disabled={busy || !location.trim() || selectedPortals.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {busy ? "Analizando portales…" : "Buscar oportunidades"}
          </button>
          <p className="text-[11px] text-slate-400 leading-snug">
            La IA busca en los portales en tiempo real y analiza cada propiedad. Puede tardar 1-3 minutos.
          </p>
        </div>

        {/* Resultados / Favoritos */}
        <div className="lg:col-span-8 space-y-4">
          {/* Conmutador */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
            <button
              type="button"
              onClick={() => setView("results")}
              className={clsx(
                "px-3 py-1.5 text-xs font-medium rounded-md",
                view === "results" ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Resultados
            </button>
            <button
              type="button"
              onClick={() => setView("favs")}
              className={clsx(
                "px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5",
                view === "favs" ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Star className="h-3.5 w-3.5" fill={favs.length ? "currentColor" : "none"} />
              Favoritos{favs.length ? ` (${favs.length})` : ""}
            </button>
          </div>

          {view === "favs" ? (
            favs.length === 0 ? (
              <div className="bg-white rounded-xl border p-10 text-center text-slate-400">
                <Star className="h-10 w-10 mx-auto mb-3 text-slate-300" />
                <p className="text-sm">
                  Aún no has guardado favoritos. Pulsa la <span className="font-medium">estrella</span> en
                  cualquier propiedad para guardarla aquí.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-slate-500">
                  {favs.length} {favs.length === 1 ? "favorito guardado" : "favoritos guardados"}
                </div>
                {favs.map((f) => (
                  <OpportunityCard
                    key={f.id}
                    o={f.o}
                    fav={true}
                    onToggleFav={() => toggleFav(f.o)}
                  />
                ))}
              </div>
            )
          ) : (
            <>
              {busy && (
                <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
                  Rastreando portales y evaluando oportunidades de inversión…
                </div>
              )}

              {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {!busy && !error && !result && (
                <div className="bg-white rounded-xl border p-10 text-center text-slate-400">
                  <Building2 className="h-10 w-10 mx-auto mb-3 text-slate-300" />
                  <p className="text-sm">
                    Introduce una zona y pulsa <span className="font-medium">Buscar oportunidades</span>.
                  </p>
                </div>
              )}

              {result && (
                <>
                  {result.summary && (
                    <div className="bg-slate-50 border rounded-xl p-4">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                        Resumen del análisis
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{result.summary}</p>
                    </div>
                  )}

                  {result.opportunities.length === 0 ? (
                    <div className="bg-white rounded-xl border p-8 text-center text-slate-500 text-sm">
                      No se encontraron propiedades que encajen con los criterios en los portales seleccionados.
                      {result.notes && <p className="mt-2 text-xs text-slate-400">{result.notes}</p>}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500">
                        {result.opportunities.length} propiedad
                        {result.opportunities.length !== 1 ? "es" : ""} analizada
                        {result.opportunities.length !== 1 ? "s" : ""}
                      </div>
                      {result.opportunities.map((o, i) => (
                        <OpportunityCard
                          key={i}
                          o={o}
                          fav={isFav(o)}
                          onToggleFav={() => toggleFav(o)}
                        />
                      ))}
                      {result.notes && (
                        <p className="text-[11px] text-slate-400 px-1">{result.notes}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OpportunityCard({
  o,
  fav,
  onToggleFav
}: {
  o: Opportunity;
  fav?: boolean;
  onToggleFav?: () => void;
}) {
  const c = verdictColor(o.verdict);
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-start gap-4">
        <ScoreBadge score={o.score} verdict={o.verdict} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={clsx(
                "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded",
                c === "emerald" && "bg-emerald-100 text-emerald-700",
                c === "amber" && "bg-amber-100 text-amber-700",
                c === "rose" && "bg-rose-100 text-rose-700"
              )}
            >
              {o.verdict}
            </span>
            <span className="text-[11px] text-slate-400">
              {o.portal_label} · {o.bank}
            </span>
            {o.occupied && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                Ocupada
              </span>
            )}
            {onToggleFav && (
              <button
                type="button"
                onClick={onToggleFav}
                title={fav ? "Quitar de favoritos" : "Guardar en favoritos"}
                className={clsx(
                  "ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border",
                  fav
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                )}
              >
                <Star className="h-3.5 w-3.5" fill={fav ? "currentColor" : "none"} />
                {fav ? "Guardada" : "Guardar"}
              </button>
            )}
          </div>
          {o.url ? (
            <a
              href={o.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-sm font-semibold text-brand-700 hover:underline truncate"
              title={o.title}
            >
              {o.title}
            </a>
          ) : (
            <h3 className="mt-1 text-sm font-semibold text-slate-800 truncate">{o.title}</h3>
          )}
          <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3" /> {o.location} · {o.property_type}
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Metric label="Precio" value={eur(o.price)} strong />
            <Metric label="Superficie" value={o.surface ? `${o.surface} m²` : "—"} />
            <Metric label="€/m²" value={o.price_m2 ? eur(o.price_m2) : "—"} />
            <Metric
              label="Descuento"
              value={o.discount_pct != null ? `${o.discount_pct}%` : "—"}
              positive={o.discount_pct != null && o.discount_pct > 0}
            />
            <Metric label="Precio mercado" value={eur(o.estimated_market_price)} />
            <Metric label="Alquiler est." value={o.estimated_rent ? `${eur(o.estimated_rent)}/mes` : "—"} />
            <Metric
              label="Rentab. bruta"
              value={o.gross_yield != null ? `${o.gross_yield}%` : "—"}
              positive={o.gross_yield != null && o.gross_yield >= 6}
            />
            <div className="flex items-end">
              {o.url ? (
                <a
                  href={o.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-brand-600 hover:bg-brand-700 text-white font-medium"
                >
                  Ver oferta <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-slate-400">Sin enlace</span>
              )}
            </div>
          </div>

          {(o.pros?.length > 0 || o.cons?.length > 0) && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {o.pros?.length > 0 && (
                <ul className="space-y-0.5">
                  {o.pros.map((p, i) => (
                    <li key={i} className="text-xs text-emerald-700 flex items-start gap-1">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" /> {p}
                    </li>
                  ))}
                </ul>
              )}
              {o.cons?.length > 0 && (
                <ul className="space-y-0.5">
                  {o.cons.map((p, i) => (
                    <li key={i} className="text-xs text-rose-600 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {o.reasoning && (
            <p className="mt-2 text-xs text-slate-600 leading-relaxed flex items-start gap-1">
              <TrendingUp className="h-3 w-3 mt-0.5 shrink-0 text-slate-400" />
              {o.reasoning}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  strong,
  positive
}: {
  label: string;
  value: string;
  strong?: boolean;
  positive?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div
        className={clsx(
          "font-medium",
          strong && "text-sm text-slate-900",
          positive && "text-emerald-600",
          !strong && !positive && "text-slate-700"
        )}
      >
        {value}
      </div>
    </div>
  );
}
