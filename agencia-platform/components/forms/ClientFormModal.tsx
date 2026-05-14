"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { Loader2 } from "lucide-react";

type ClientPayload = {
  id?: string;
  name: string;
  industry?: string;
  status?: "ACTIVE" | "PAUSED" | "PROSPECT" | "CHURNED";
  contactName?: string;
  email?: string;
  phone?: string;
  mrr?: number;
  notes?: string;
};

const statusOptions = [
  { value: "ACTIVE", label: "Activo" },
  { value: "PAUSED", label: "En pausa" },
  { value: "PROSPECT", label: "Prospecto" },
  { value: "CHURNED", label: "Perdido" }
] as const;

export default function ClientFormModal({
  open,
  onClose,
  client,
  mode = "create"
}: {
  open: boolean;
  onClose: () => void;
  client?: ClientPayload | null;
  mode?: "create" | "edit" | "notes";
}) {
  const router = useRouter();
  const isEdit = mode !== "create";

  const [form, setForm] = useState<ClientPayload>({ name: "", status: "ACTIVE", mrr: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      client ?? { name: "", status: "ACTIVE", mrr: 0 }
    );
  }, [open, client]);

  function update<K extends keyof ClientPayload>(key: K, val: ClientPayload[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "create" && !form.name.trim()) return setError("El nombre es obligatorio");

    setSaving(true);
    const isPatch = isEdit && client?.id;
    const url = isPatch ? `/api/v1/clients/${client!.id}` : "/api/v1/clients";
    const payload: any = {
      name: form.name,
      industry: form.industry || undefined,
      status: form.status,
      contactName: form.contactName || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      mrr: Number(form.mrr ?? 0),
      notes: form.notes || undefined
    };
    if (mode === "notes") {
      // sólo enviamos notes
      for (const k of Object.keys(payload)) if (k !== "notes") delete payload[k];
    }

    const r = await fetch(url, {
      method: isPatch ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return setError(j.message || `Error ${r.status}`);
    }
    router.refresh();
    onClose();
  }

  const title =
    mode === "create" ? "Nuevo cliente" : mode === "notes" ? "Notas internas" : "Editar cliente";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="client-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <form id="client-form" onSubmit={handleSubmit} className="space-y-4">
        {mode === "notes" ? (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notas internas</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              autoFocus
              rows={10}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Apuntes internos del cliente…"
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Nombre</label>
                <input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sector</label>
                <input
                  value={form.industry ?? ""}
                  onChange={(e) => update("industry", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Estado</label>
                <select
                  value={form.status}
                  onChange={(e) => update("status", e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Persona de contacto</label>
                <input
                  value={form.contactName ?? ""}
                  onChange={(e) => update("contactName", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">MRR (€)</label>
                <input
                  type="number"
                  min={0}
                  value={form.mrr ?? 0}
                  onChange={(e) => update("mrr", Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) => update("email", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Teléfono</label>
                <input
                  value={form.phone ?? ""}
                  onChange={(e) => update("phone", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Notas</label>
              <textarea
                value={form.notes ?? ""}
                onChange={(e) => update("notes", e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
