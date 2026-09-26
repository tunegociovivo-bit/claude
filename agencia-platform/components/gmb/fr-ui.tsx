"use client";

/** Piezas de UI compartidas por el detector de reseñas falsas y el escudo de reputación. */
import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { Place } from "@/lib/gmb/fake-reviews/core";

export type Ficha = { id: string; name: string; placeId?: string; address?: string };

export const CARD = "bg-white rounded-xl border p-4";
export const BTN = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium";
export const BTN_PRIMARY = `${BTN} bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50`;
export const BTN_SEC = `${BTN} border bg-white hover:bg-slate-50`;

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message ?? d?.message ?? `Error ${r.status}`);
  return d as T;
}

export function Stars({ n }: { n: number | null }) {
  const r = Math.round(n ?? 0);
  return (
    <span className="whitespace-nowrap">
      <span className="text-amber-400">{"★".repeat(r)}</span>
      <span className="text-slate-300">{"★".repeat(Math.max(0, 5 - r))}</span>
    </span>
  );
}

export function PlaceChip({ p, onClear, onPick }: { p: Place; onClear?: () => void; onPick?: () => void }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${onClear ? "border-amber-400 bg-amber-50/50" : "bg-slate-50"}`}>
      {p.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.thumbnail} alt="" referrerPolicy="no-referrer" className="h-11 w-11 rounded-md object-cover" />
      ) : (
        <div className="h-11 w-11 rounded-md bg-slate-200" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{p.title}</div>
        <div className="text-xs text-slate-500 truncate">{p.address}{p.type ? ` · ${p.type}` : ""}</div>
        <div className="text-xs">
          {p.rating != null && <><b>{p.rating.toFixed(1).replace(".", ",")}</b> <Stars n={p.rating} /> </>}
          {p.reviews != null && <span className="text-slate-500">{p.reviews} reseñas</span>}
        </div>
      </div>
      {onPick && <button onClick={onPick} className={BTN_SEC}>Elegir</button>}
      {onClear && (
        <button onClick={onClear} className="text-xs text-slate-500 hover:text-slate-800 underline">Cambiar</button>
      )}
    </div>
  );
}

export function PlacePicker({
  label,
  value,
  onChange,
  fichas,
  onFicha,
  placeholder,
  onRemove
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  fichas?: Ficha[];
  onFicha?: (id: string | null) => void;
  placeholder: string;
  onRemove?: () => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cands, setCands] = useState<Place[]>([]);

  async function find(query = q) {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    setCands([]);
    try {
      const d = await api<{ place?: Place; candidates?: Place[] }>("/api/v1/gmb/fake-reviews/resolve", { method: "POST", body: JSON.stringify({ q: query.trim() }) });
      if (d.place) onChange(d.place);
      else setCands(d.candidates ?? []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-700">{label}</label>
        {onRemove && (
          <button onClick={onRemove} className="text-xs text-rose-600 hover:underline">Quitar</button>
        )}
      </div>
      {value ? (
        <PlaceChip p={value} onClear={() => { onChange(null); onFicha?.(null); }} />
      ) : (
        <>
          {fichas && fichas.length > 0 && (
            <select
              className="w-full px-3 py-2 rounded-lg border text-sm bg-white"
              defaultValue=""
              onChange={(e) => {
                const f = fichas.find((x) => x.id === e.target.value);
                if (!f) return;
                onFicha?.(f.id);
                const query = f.placeId ? `place_id:${f.placeId}` : `${f.name} ${f.address ?? ""}`.trim();
                setQ(f.placeId ? f.name : query);
                find(query);
              }}
            >
              <option value="" disabled>Elegir una ficha del GMB Hub…</option>
              {fichas.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), find())}
              placeholder={placeholder}
              className="flex-1 px-3 py-2 rounded-lg border text-sm"
            />
            <button onClick={() => find()} disabled={busy || !q.trim()} className={BTN_SEC}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
            </button>
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          {cands.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500">Varias coincidencias, elige la correcta:</p>
              {cands.map((c, i) => (
                <PlaceChip key={i} p={c} onPick={() => { onChange(c); setCands([]); }} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

