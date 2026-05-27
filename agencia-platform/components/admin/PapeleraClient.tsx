"use client";

import { useEffect, useState } from "react";
import { Trash2, Undo2, Loader2, CheckSquare, Users, FolderKanban, FileText } from "lucide-react";

type TrashItem = {
  id: string;
  model: "task" | "project" | "document" | "client";
  title: string;
  deletedAt: string;
  deletedById: string | null;
  deletedByName: string | null;
  context: string | null;
};

const MODEL_LABEL: Record<TrashItem["model"], string> = {
  task: "Tarea",
  project: "Proyecto",
  document: "Documento",
  client: "Cliente"
};

const MODEL_ICON: Record<TrashItem["model"], any> = {
  task: CheckSquare,
  project: FolderKanban,
  document: FileText,
  client: Users
};

export default function PapeleraClient() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | TrashItem["model"]>("all");
  const [working, setWorking] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/trash");
      if (r.ok) {
        const data = await r.json();
        setItems(data.items ?? []);
        setRetentionDays(data.retentionDays ?? 30);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function restore(it: TrashItem) {
    setWorking(`r-${it.id}`);
    try {
      const r = await fetch(`/api/v1/trash/${it.model}/${it.id}`, { method: "POST" });
      if (r.ok) setItems((prev) => prev.filter((x) => x.id !== it.id));
    } finally {
      setWorking(null);
    }
  }

  async function purge(it: TrashItem) {
    if (!confirm(`¿Borrar PERMANENTEMENTE "${it.title}"?\n\nEsta acción no se puede deshacer.`)) return;
    setWorking(`p-${it.id}`);
    try {
      const r = await fetch(`/api/v1/trash/${it.model}/${it.id}`, { method: "DELETE" });
      if (r.ok) setItems((prev) => prev.filter((x) => x.id !== it.id));
    } finally {
      setWorking(null);
    }
  }

  const filtered = filter === "all" ? items : items.filter((i) => i.model === filter);

  function daysLeft(deletedAt: string): number {
    const purgeAt = new Date(deletedAt).getTime() + retentionDays * 86_400_000;
    return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 text-xs">
        {(["all", "task", "project", "document", "client"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              "px-3 py-1.5 rounded-full border " +
              (filter === f ? "bg-brand-600 text-white border-brand-600" : "bg-white hover:bg-slate-50")
            }
          >
            {f === "all"
              ? `Todo (${items.length})`
              : `${MODEL_LABEL[f]} (${items.filter((i) => i.model === f).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-slate-500">
          Papelera vacía. {filter === "all" ? "No hay nada borrado." : "Nada de este tipo."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 w-24">Tipo</th>
                <th className="text-left px-3 py-2">Título</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">Borrado por</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Hace</th>
                <th className="text-right px-3 py-2 w-40">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const Icon = MODEL_ICON[it.model];
                const left = daysLeft(it.deletedAt);
                return (
                  <tr key={`${it.model}-${it.id}`} className="border-t">
                    <td className="px-3 py-2 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-slate-400" />
                        {MODEL_LABEL[it.model]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-900 truncate">{it.title}</div>
                      {it.context && (
                        <div className="text-[11px] text-slate-500 truncate">{it.context}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 hidden md:table-cell">
                      {it.deletedByName ?? <span className="italic text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {new Date(it.deletedAt).toLocaleDateString("es-ES")}
                      {" · "}
                      <span className={left <= 3 ? "text-rose-600 font-medium" : ""}>
                        {left}d para purga
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => restore(it)}
                          disabled={working === `r-${it.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-white hover:bg-emerald-50 hover:text-emerald-700 text-xs disabled:opacity-50"
                          title="Restaurar"
                        >
                          {working === `r-${it.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Undo2 className="h-3 w-3" />
                          )}
                          Restaurar
                        </button>
                        <button
                          onClick={() => purge(it)}
                          disabled={working === `p-${it.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs disabled:opacity-50"
                          title="Purgar definitivo"
                        >
                          {working === `p-${it.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Purgar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
