"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Calendar, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

type CalItem = {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  urlPreview: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

const PALETTE = [
  "#8b5cf6", // violeta (default)
  "#0ea5e9", // azul claro
  "#10b981", // verde
  "#f59e0b", // ámbar
  "#ec4899", // rosa
  "#64748b" // gris pizarra
];

export default function ExternalCalendarsSection() {
  const [items, setItems] = useState<CalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form de creación
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [color, setColor] = useState(PALETTE[0]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/me/external-calendars");
      if (r.ok) {
        const data = await r.json();
        setItems(data.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !icsUrl.trim()) {
      setError("Nombre y URL son obligatorios");
      return;
    }
    setAdding(true);
    try {
      const r = await fetch("/api/v1/me/external-calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), icsUrl: icsUrl.trim(), color })
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        setError(data?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setName("");
      setIcsUrl("");
      setColor(PALETTE[0]);
      setShowForm(false);
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function toggleEnabled(item: CalItem) {
    await fetch(`/api/v1/me/external-calendars/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !item.enabled })
    });
    await load();
  }

  async function remove(item: CalItem) {
    if (!confirm(`¿Eliminar el calendario "${item.name}"?\n\nDejará de mostrarse en /calendario. La URL no se borra de Google/Outlook — sólo tu vinculación a esta plataforma.`)) return;
    await fetch(`/api/v1/me/external-calendars/${item.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4 mt-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-violet-600" />
            Mis calendarios externos
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Vincula tu Google Calendar / Outlook / iCloud por URL iCal secreta. Los eventos se mostrarán en{" "}
            <a href="/calendario" className="text-brand-600 underline">/calendario</a> con tu color.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border bg-white hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Añadir
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={add} className="rounded-lg border bg-violet-50/30 border-violet-200 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">Nombre</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mi Google Calendar"
                className="w-full px-2.5 py-1.5 rounded-md border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">Color</label>
              <div className="flex gap-1">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={
                      "h-6 w-6 rounded-md border-2 " +
                      (color === c ? "border-slate-900" : "border-white")
                    }
                  />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">URL iCal secreta</label>
            <input
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/..../basic.ics"
              className="w-full px-2.5 py-1.5 rounded-md border bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              <strong>Google Calendar:</strong> Settings → Settings for my calendars → tu calendario → Integrate calendar → "Secret address in iCal format".
              <br />
              <strong>Outlook:</strong> Settings → Calendar → Shared calendars → Publish a calendar → ICS link.
              <br />
              <strong>iCloud:</strong> Comparte el calendario como público y copia la URL webcal://.
            </p>
          </div>
          {error && <p className="text-[11px] text-rose-700">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={adding}
              className="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> : null}
              Añadir calendario
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setError(null);
                setName("");
                setIcsUrl("");
              }}
              className="px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-xs"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">Aún no has vinculado ningún calendario.</p>
      ) : (
        <ul className="divide-y border rounded-lg">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: it.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{it.name}</div>
                <div className="text-[11px] text-slate-500 font-mono truncate">{it.urlPreview}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                  {it.lastError ? (
                    <span className="inline-flex items-center gap-1 text-rose-600">
                      <AlertCircle className="h-3 w-3" /> Error: {it.lastError.slice(0, 60)}
                    </span>
                  ) : it.lastSyncedAt ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> Sincronizado{" "}
                      {new Date(it.lastSyncedAt).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      <RefreshCw className="h-3 w-3" /> Pendiente de primera sincronización
                    </span>
                  )}
                </div>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={it.enabled}
                  onChange={() => toggleEnabled(it)}
                  className="accent-violet-600"
                />
                Visible
              </label>
              <button
                onClick={() => remove(it)}
                className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                title="Eliminar calendario"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
