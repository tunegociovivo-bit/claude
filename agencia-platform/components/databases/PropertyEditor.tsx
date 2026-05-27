"use client";

import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { propertyTypes } from "@/lib/api/db-schemas";
import type { DbProperty, DbPropertyType } from "@/lib/db/types";

const supportedTypes: DbPropertyType[] = [
  "TEXT",
  "NUMBER",
  "SELECT",
  "MULTI_SELECT",
  "DATE",
  "CHECKBOX",
  "URL",
  "EMAIL",
  "PHONE"
];

const palette = [
  "bg-slate-200",
  "bg-rose-200",
  "bg-amber-200",
  "bg-emerald-200",
  "bg-sky-200",
  "bg-indigo-200",
  "bg-purple-200"
];

export default function PropertyEditor({
  property,
  onClose,
  onSave,
  onDelete
}: {
  property: DbProperty | null; // null = nueva propiedad
  onClose: () => void;
  onSave: (data: Partial<DbProperty>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const isNew = !property;
  const [name, setName] = useState(property?.name ?? "");
  const [type, setType] = useState<DbPropertyType>(property?.type ?? "TEXT");
  const [options, setOptions] = useState<{ label: string; color: string }[]>(
    property?.config?.options ?? []
  );
  const [busy, setBusy] = useState(false);

  const needsOptions = type === "SELECT" || type === "MULTI_SELECT";

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    await onSave({
      name: name.trim(),
      type,
      config: needsOptions ? { options } : {}
    });
    setBusy(false);
    onClose();
  }

  async function remove() {
    if (!onDelete) return;
    if (!confirm("¿Eliminar esta propiedad y todos sus valores?")) return;
    setBusy(true);
    await onDelete();
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 grid place-items-center p-4">
      <div className="bg-white rounded-xl border shadow-xl w-full max-w-sm">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">{isNew ? "Nueva propiedad" : "Editar propiedad"}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-slate-600 font-medium">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Estado, Fecha, Responsable…"
              className="mt-1 w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 font-medium">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as DbPropertyType)}
              disabled={!isNew}
              className="mt-1 w-full px-3 py-2 rounded-lg border text-sm bg-white disabled:bg-slate-50"
            >
              {supportedTypes.map((t) => (
                <option key={t} value={t}>{t.toLowerCase().replace("_", " ")}</option>
              ))}
            </select>
            {!isNew && (
              <p className="text-[11px] text-slate-400 mt-1">
                El tipo no se puede cambiar una vez creada la propiedad.
              </p>
            )}
          </div>

          {needsOptions && (
            <div>
              <label className="text-xs text-slate-600 font-medium block mb-2">Opciones</label>
              <div className="space-y-1.5">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const idx = palette.indexOf(o.color);
                        const next = palette[(idx + 1) % palette.length];
                        const copy = [...options];
                        copy[i] = { ...o, color: next };
                        setOptions(copy);
                      }}
                      className={`h-6 w-6 rounded ${o.color} border`}
                    />
                    <input
                      value={o.label}
                      onChange={(e) => {
                        const copy = [...options];
                        copy[i] = { ...o, label: e.target.value };
                        setOptions(copy);
                      }}
                      className="flex-1 px-2 py-1 rounded border text-sm"
                    />
                    <button
                      onClick={() => setOptions(options.filter((_, k) => k !== i))}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setOptions([...options, { label: `Opción ${options.length + 1}`, color: palette[options.length % palette.length] }])}
                  className="text-xs text-brand-600 inline-flex items-center gap-1 mt-1"
                >
                  <Plus className="h-3 w-3" /> Añadir opción
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t flex items-center justify-between gap-2">
          {!isNew && onDelete ? (
            <button
              onClick={remove}
              disabled={busy}
              className="text-xs text-rose-600 hover:text-rose-700 disabled:opacity-50"
            >
              Eliminar propiedad
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border text-sm hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={busy || !name.trim()}
              className="px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
