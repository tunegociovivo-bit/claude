"use client";

import { useState } from "react";
import clsx from "clsx";
import { Plus, Pencil, Trash2, Bell, BellOff, Loader2, Power } from "lucide-react";
import { jsonFetch } from "@/components/inbox/ui";
import type { Overview, SearchView } from "./types";
import SearchEditor from "./SearchEditor";

export default function SearchesView({ overview, reload }: { overview: Overview; reload: () => void }) {
  const { searches, isAdmin } = overview;
  const [editing, setEditing] = useState<SearchView | "new" | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");

  async function toggleActive(s: SearchView) {
    setBusy(s.id);
    await jsonFetch(`/api/v1/radar/searches/${s.id}`, { method: "PUT", body: JSON.stringify({ active: !s.active }) });
    setBusy("");
    reload();
  }

  async function remove(s: SearchView) {
    if (!confirm(`¿Borrar la búsqueda «${s.name}»? Se quitarán también sus coincidencias.`)) return;
    setBusy(s.id);
    await jsonFetch(`/api/v1/radar/searches/${s.id}`, { method: "DELETE" });
    setBusy("");
    reload();
  }

  if (editing) {
    return (
      <SearchEditor
        overview={overview}
        search={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); }}
      />
    );
  }

  return (
    <div>
      {isAdmin && (
        <button onClick={() => setEditing("new")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
          <Plus size={16} /> Nueva búsqueda
        </button>
      )}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

      {searches.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
          No hay búsquedas. Crea una para decirle al radar qué coches te interesan (marca, precio, km, combustible…).
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {searches.map((s) => (
            <div key={s.id} className={clsx("rounded-2xl border bg-white p-3 shadow-sm", s.active ? "border-slate-200" : "border-slate-200 opacity-70")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-slate-900">{s.name}</h3>
                    {!s.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">En pausa</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{s.summary}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span>{s.matchCount} coche(s)</span>
                    <span className="inline-flex items-center gap-1">{s.notifyWhatsapp ? <Bell size={11} /> : <BellOff size={11} />} WhatsApp</span>
                    <span className="inline-flex items-center gap-1">{s.notifyEmail ? <Bell size={11} /> : <BellOff size={11} />} Email</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 gap-0.5">
                    <button title={s.active ? "Pausar" : "Activar"} onClick={() => void toggleActive(s)} disabled={busy === s.id} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                      {busy === s.id ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                    </button>
                    <button title="Editar" onClick={() => setEditing(s)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700"><Pencil size={15} /></button>
                    <button title="Borrar" onClick={() => void remove(s)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
