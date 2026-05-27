"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { Plus, Database as DatabaseIcon, Loader2, ArrowUpRight } from "lucide-react";

type Row = {
  id: string;
  name: string;
  icon: string | null;
  _count: { records: number; properties: number; views: number };
};

export default function DatabasesClient() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/databases");
      if (r.ok) {
        const data = await r.json();
        setItems(data.items);
      }
    } finally {
      setLoading(false);
    }
  }

  async function createNew() {
    setCreating(true);
    const r = await fetch("/api/v1/databases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nueva base de datos", icon: "🗂️" })
    });
    setCreating(false);
    if (r.ok) {
      const created = await r.json();
      window.location.href = `/databases/${created.id}`;
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Bases de datos"
        description="Crea bases con propiedades tipadas y míralas en tabla, kanban o calendario."
        actions={
          <button
            onClick={createNew}
            disabled={creating}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {creating ? "Creando…" : "Nueva base"}
          </button>
        }
      />

      {loading ? (
        <div className="bg-white rounded-xl border p-8 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center">
          <div className="h-12 w-12 rounded-xl bg-brand-50 text-brand-600 grid place-items-center mx-auto mb-3">
            <DatabaseIcon className="h-6 w-6" />
          </div>
          <h2 className="font-semibold mb-1">Aún no hay bases de datos</h2>
          <p className="text-sm text-slate-500 mb-4">
            Las bases de datos te permiten organizar cualquier cosa (calendario editorial, tareas, leads, ideas…)
            con columnas tipadas y verlas como tabla, tablero o calendario.
          </p>
          <button
            onClick={createNew}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> Crear la primera
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((d) => (
            <Link
              key={d.id}
              href={`/databases/${d.id}`}
              className="bg-white rounded-xl border p-5 hover:shadow-sm hover:border-brand-200 transition group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-lg bg-brand-50 text-brand-600 grid place-items-center text-xl">
                    {d.icon ?? <DatabaseIcon className="h-5 w-5" />}
                  </div>
                  <h3 className="font-semibold leading-tight">{d.name}</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600" />
              </div>
              <div className="grid grid-cols-3 text-xs">
                <div>
                  <div className="text-slate-500">Registros</div>
                  <div className="font-semibold">{d._count.records}</div>
                </div>
                <div>
                  <div className="text-slate-500">Columnas</div>
                  <div className="font-semibold">{d._count.properties}</div>
                </div>
                <div>
                  <div className="text-slate-500">Vistas</div>
                  <div className="font-semibold">{d._count.views}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
