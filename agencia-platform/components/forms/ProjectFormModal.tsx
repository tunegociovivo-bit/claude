"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import type { UiClient } from "@/lib/db/queries";
import { Loader2, User as UserIcon } from "lucide-react";

const colorOptions = [
  "bg-brand-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-indigo-500",
  "bg-pink-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-slate-500",
  "bg-yellow-500"
];

// Emojis comunes para proyectos. El user también puede tipear libre.
const emojiSuggestions = [
  "🚀", "📣", "🎯", "💼", "📊", "🛠️", "🎨", "📱",
  "🌐", "💰", "📈", "🤝", "📝", "⚡", "🔧", "🎬",
  "📷", "🏠", "🚗", "🍽️", "🏥", "⚖️", "🏛️", "🎓"
];

type ProjectInput = {
  id: string;
  name: string;
  description?: string | null;
  clientId?: string | null;
  color?: string | null;
  emoji?: string | null;
  managerUserId?: string | null;
};

type Member = { id: string; name: string | null; email: string; image: string | null };

export default function ProjectFormModal({
  open,
  onClose,
  clients,
  project
}: {
  open: boolean;
  onClose: () => void;
  clients: UiClient[];
  /** Si se pasa, el modal entra en modo EDICIÓN. Si no, modo CREACIÓN. */
  project?: ProjectInput | null;
}) {
  const router = useRouter();
  const isEdit = !!project;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [color, setColor] = useState(colorOptions[0]);
  const [emoji, setEmoji] = useState("");
  const [managerUserId, setManagerUserId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setClientId(project?.clientId ?? "");
    setColor(project?.color ?? colorOptions[0]);
    setEmoji(project?.emoji ?? "");
    setManagerUserId(project?.managerUserId ?? "");
  }, [open, project]);

  // Cargar miembros del workspace para el selector de manager.
  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/users")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.items) setMembers(d.items as Member[]);
      })
      .catch(() => {});
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("El nombre es obligatorio");

    setSaving(true);
    const url = isEdit ? `/api/v1/projects/${project!.id}` : "/api/v1/projects";
    const method = isEdit ? "PATCH" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        clientId: clientId || null,
        color,
        emoji: emoji.trim() || null,
        managerUserId: managerUserId || null
      })
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return setError(j.error?.message ?? j.message ?? `Error ${r.status}`);
    }
    router.refresh();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar proyecto" : "Nuevo proyecto"}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="project-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Guardar cambios" : "Crear proyecto"}
          </button>
        </>
      }
    >
      <form id="project-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3">
          <div className="w-24">
            <label className="block text-xs font-medium text-slate-700 mb-1">Emoji</label>
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
              placeholder="🚀"
              className="w-full px-3 py-2 rounded-lg border bg-white text-2xl text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Nombre del proyecto
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Ej. Campaña verano 2026"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {emojiSuggestions.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={
                "h-8 w-8 rounded-md hover:bg-slate-100 text-lg transition " +
                (emoji === e ? "bg-slate-200 ring-2 ring-brand-500" : "bg-slate-50")
              }
            >
              {e}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Cliente (opcional)
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— Interno / sin cliente —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Gestor del proyecto
            </label>
            <select
              value={managerUserId}
              onChange={(e) => setManagerUserId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— Sin asignar —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
            {managerUserId &&
              (() => {
                const m = members.find((x) => x.id === managerUserId);
                if (!m) return null;
                return (
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                    {m.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.image}
                        alt={m.name ?? m.email}
                        className="h-7 w-7 rounded-full object-cover border"
                      />
                    ) : (
                      <span className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center">
                        <UserIcon className="h-4 w-4 text-slate-500" />
                      </span>
                    )}
                    <span>{m.name ?? m.email}</span>
                  </div>
                );
              })()}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Color</label>
          <div className="flex flex-wrap gap-2">
            {colorOptions.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={
                  "h-7 w-7 rounded-full " +
                  c +
                  " border-2 transition " +
                  (color === c ? "border-slate-900 scale-110" : "border-white")
                }
              />
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
