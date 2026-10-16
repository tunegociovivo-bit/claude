"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Car, ExternalLink, Loader2, Star, Eye, X, Clock } from "lucide-react";
import { jsonFetch } from "@/components/inbox/ui";
import type { MatchView, SearchView } from "./types";
import { fmtEuros, fmtKm, fmtDateTime, fmtRelative } from "./types";

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: "new", label: "Sin ver" },
  { id: "interesting", label: "Interesantes" },
  { id: "", label: "Todos" },
  { id: "discarded", label: "Descartados" },
];

export default function ResultsView({ searches, onChanged }: { searches: SearchView[]; onChanged: () => void }) {
  const [status, setStatus] = useState("new");
  const [searchId, setSearchId] = useState("");
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (reset: boolean) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (searchId) params.set("searchId", searchId);
    if (!reset && cursor) params.set("cursor", cursor);
    const { ok, data } = await jsonFetch<{ matches: MatchView[]; nextCursor: string | null }>(`/api/v1/radar/matches?${params}`);
    if (ok) {
      setMatches((prev) => (reset ? data.matches : [...prev, ...data.matches]));
      setCursor(data.nextCursor);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [status, searchId, cursor]);

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, searchId]);

  async function setMatchStatus(matchId: string, next: string) {
    setMatches((prev) => prev.map((m) => (m.matchId === matchId ? { ...m, status: next } : m)));
    await jsonFetch(`/api/v1/radar/matches/${matchId}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    // Si el filtro excluye el nuevo estado, quítalo de la lista.
    if (status && status !== next) setMatches((prev) => prev.filter((m) => m.matchId !== matchId));
    onChanged();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id || "all"}
              onClick={() => setStatus(f.id)}
              className={clsx("rounded-md px-2.5 py-1 font-medium transition", status === f.id ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}
            >
              {f.label}
            </button>
          ))}
        </div>
        {searches.length > 0 && (
          <select
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
          >
            <option value="">Todas las búsquedas</option>
            {searches.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="animate-spin" /></div>
      ) : matches.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 py-14 text-center text-slate-500">
          <Car className="text-slate-300" size={32} />
          <p className="text-sm">
            {status === "new" ? "No hay coches nuevos por ahora." : "Nada por aquí todavía."}
          </p>
          {searches.length === 0 && <p className="text-xs">Crea una búsqueda para que el radar sepa qué coches te interesan.</p>}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {matches.map((m) => (
            <MatchCard key={m.matchId} match={m} onStatus={setMatchStatus} />
          ))}
        </div>
      )}

      {cursor && !loading && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => void load(false)} disabled={loadingMore} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {loadingMore && <Loader2 size={14} className="animate-spin" />}Ver más
          </button>
        </div>
      )}
    </div>
  );
}

function MatchCard({ match, onStatus }: { match: MatchView; onStatus: (id: string, status: string) => void }) {
  const l = match.listing;
  const specs = [l.year ? String(l.year) : null, l.km !== null ? fmtKm(l.km) : null, l.fuel, l.gearbox, l.powerCv ? `${l.powerCv} CV` : null].filter(Boolean);
  // Al pinchar el coche (foto o título) se abre su ficha en el portal, en otra
  // pestaña, para poder pujar. Si el portal no da enlace a la ficha, no es clicable.
  const href = l.url || null;
  return (
    <div className={clsx("flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition", match.status === "discarded" ? "border-slate-200 opacity-60" : "border-slate-200")}>
      <div className="flex gap-3 p-3">
        <CardLink href={href} title="Abrir en el portal para pujar" className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100">
          {l.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300"><Car size={24} /></div>
          )}
        </CardLink>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" title="Abrir en el portal para pujar" className="line-clamp-2 text-sm font-semibold text-slate-900 hover:text-brand-700 hover:underline">{l.title}</a>
            ) : (
              <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{l.title}</h3>
            )}
            {match.status === "new" && <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">NUEVO</span>}
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{specs.join(" · ")}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-base font-bold text-slate-900">{fmtEuros(l.price)}</span>
            {l.priceLabel && <span className="text-[11px] text-slate-400">{l.priceLabel}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
            <span className="font-medium text-slate-500">{l.portalName}</span>
            {l.country && <span>· {l.country}</span>}
            {l.auctionEndsAt && (
              <span className="inline-flex items-center gap-0.5 text-amber-600"><Clock size={11} />Termina {fmtDateTime(l.auctionEndsAt)}</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-slate-100 px-2 py-1.5">
        <div className="flex gap-0.5">
          <IconBtn active={match.status === "interesting"} title="Me interesa" onClick={() => onStatus(match.matchId, "interesting")}>
            <Star size={16} className={match.status === "interesting" ? "fill-amber-400 text-amber-500" : ""} />
          </IconBtn>
          <IconBtn active={match.status === "seen"} title="Visto" onClick={() => onStatus(match.matchId, "seen")}>
            <Eye size={16} />
          </IconBtn>
          <IconBtn active={match.status === "discarded"} title="Descartar" onClick={() => onStatus(match.matchId, "discarded")}>
            <X size={16} />
          </IconBtn>
        </div>
        {l.url ? (
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
            Abrir <ExternalLink size={13} />
          </a>
        ) : (
          <span className="text-[11px] text-slate-400">{match.searchName}</span>
        )}
      </div>
    </div>
  );
}

// Envuelve la foto del coche en un enlace a su ficha del portal cuando lo haya;
// si no hay enlace, queda como un bloque normal (no clicable).
function CardLink({ href, title, className, children }: { href: string | null; title?: string; className?: string; children: React.ReactNode }) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={clsx(className, "block cursor-pointer")}>
      {children}
    </a>
  );
}

function IconBtn({ children, active, title, onClick }: { children: React.ReactNode; active?: boolean; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} className={clsx("flex h-9 w-9 items-center justify-center rounded-lg transition", active ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:bg-slate-50 hover:text-slate-700")}>
      {children}
    </button>
  );
}
