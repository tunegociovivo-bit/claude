"use client";

import { useEffect, useState } from "react";
import { Plus, Loader2, CheckCircle2, XCircle, Clock, Paperclip, ExternalLink } from "lucide-react";

type Client = { id: string; name: string };
type Deliverable = {
  id: string;
  title: string;
  description: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  dueAt: string | null;
  createdAt: string;
  client: { id: string; name: string };
  file: { id: string; name: string; mimeType: string; sizeBytes: number } | null;
  decisions: { id: string; decision: string; comment: string | null; createdAt: string }[];
};

export default function DeliverablesClient() {
  const [items, setItems] = useState<Deliverable[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"all" | Deliverable["status"]>("all");

  const [newClient, setNewClient] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDueAt, setNewDueAt] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        fetch("/api/v1/deliverables").then((r) => r.ok ? r.json() : { items: [] }),
        fetch("/api/v1/clients?limit=500").then((r) => r.ok ? r.json() : { items: [] })
      ]);
      setItems(d.items ?? []);
      setClients(c.items ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!newClient || !newTitle.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/v1/deliverables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: newClient,
          title: newTitle.trim(),
          description: newDescription.trim() || undefined,
          dueAt: newDueAt ? new Date(newDueAt).toISOString() : undefined
        })
      });
      if (r.ok) {
        const d = await r.json();
        setItems((prev) => [d, ...prev]);
        setNewTitle("");
        setNewDescription("");
        setNewDueAt("");
      }
    } finally {
      setCreating(false);
    }
  }

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);
  const counts = {
    all: items.length,
    PENDING: items.filter((i) => i.status === "PENDING").length,
    APPROVED: items.filter((i) => i.status === "APPROVED").length,
    REJECTED: items.filter((i) => i.status === "REJECTED").length
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-slate-900 mb-3 inline-flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nuevo entregable
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-600 block mb-1">Cliente</label>
            <select
              value={newClient}
              onChange={(e) => setNewClient(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none"
            >
              <option value="">Selecciona…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">Fecha límite (opcional)</label>
            <input
              type="date"
              value={newDueAt}
              onChange={(e) => setNewDueAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-600 block mb-1">Título</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Propuesta de logo final, vídeo de presentación…"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-600 block mb-1">Descripción (opcional)</label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              placeholder="Contexto, qué evaluar, qué decisión esperamos…"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-slate-500">
            Tras crear, sube el archivo desde el panel del entregable. El cliente lo verá al entrar al portal.
          </p>
          <button
            onClick={create}
            disabled={creating || !newClient || !newTitle.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear entregable
          </button>
        </div>
      </div>

      {/* Filtros + lista */}
      <div>
        <div className="flex items-center gap-2 mb-3 text-xs">
          {(["all", "PENDING", "APPROVED", "REJECTED"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "px-3 py-1.5 rounded-full border " +
                (filter === f
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white hover:bg-slate-50")
              }
            >
              {f === "all" ? "Todos" : f === "PENDING" ? "Pendientes" : f === "APPROVED" ? "Aprobados" : "Rechazados"}
              {" "}({counts[f]})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 italic px-1">Sin entregables todavía.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((d) => (
              <DeliverableRow key={d.id} d={d} onChange={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeliverableRow({ d, onChange }: { d: Deliverable; onChange: () => void }) {
  const lastDecision = d.decisions[d.decisions.length - 1];
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <StatusBadge status={d.status} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-900 truncate">{d.title}</div>
          <div className="text-[11px] text-slate-500">
            {d.client.name} · creado {new Date(d.createdAt).toLocaleDateString("es-ES")}
            {d.dueAt && <> · vence {new Date(d.dueAt).toLocaleDateString("es-ES")}</>}
          </div>
          {d.description && <p className="text-sm text-slate-600 mt-1">{d.description}</p>}
          {d.file && (
            <div className="mt-1 text-xs text-slate-600 inline-flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {d.file.name} ({(d.file.sizeBytes / 1024 / 1024).toFixed(1)} MB)
            </div>
          )}
          {lastDecision && (
            <div className="mt-2 text-xs">
              <span className="font-medium text-slate-700">
                {lastDecision.decision === "approved" ? "✓ Aprobado" : lastDecision.decision === "rejected" ? "✗ Rechazado" : "💬 Comentario"}
              </span>
              {lastDecision.comment && <span className="text-slate-600"> · {lastDecision.comment}</span>}
              <span className="text-slate-400 ml-1">
                ({new Date(lastDecision.createdAt).toLocaleString("es-ES")})
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "PENDING" | "APPROVED" | "REJECTED" }) {
  if (status === "APPROVED") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />;
  }
  if (status === "REJECTED") {
    return <XCircle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />;
  }
  return <Clock className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />;
}
