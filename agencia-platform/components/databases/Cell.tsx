"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import clsx from "clsx";
import type { DbProperty } from "@/lib/db/types";

type Props = {
  prop: DbProperty;
  value: any;
  onChange: (newValue: any) => void;
  compact?: boolean;
};

export default function Cell({ prop, value, onChange, compact }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    setEditing(false);
    if (JSON.stringify(draft) !== JSON.stringify(value)) onChange(draft);
  };

  if (prop.type === "TEXT" || prop.type === "URL" || prop.type === "EMAIL" || prop.type === "PHONE") {
    return editing ? (
      <input
        autoFocus
        value={draft ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="w-full px-2 py-1 text-sm bg-transparent outline outline-2 outline-brand-400 rounded"
      />
    ) : (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-left text-sm px-2 py-1 rounded hover:bg-slate-50 truncate"
      >
        {value ?? <span className="text-slate-300">—</span>}
      </button>
    );
  }

  if (prop.type === "NUMBER") {
    return editing ? (
      <input
        autoFocus
        type="number"
        value={draft ?? ""}
        onChange={(e) => setDraft(e.target.value === "" ? null : Number(e.target.value))}
        onBlur={commit}
        className="w-full px-2 py-1 text-sm bg-transparent outline outline-2 outline-brand-400 rounded"
      />
    ) : (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-right text-sm px-2 py-1 rounded hover:bg-slate-50 tabular-nums"
      >
        {value ?? <span className="text-slate-300">—</span>}
      </button>
    );
  }

  if (prop.type === "DATE") {
    return (
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full text-sm px-2 py-1 bg-transparent rounded hover:bg-slate-50 focus:outline focus:outline-2 focus:outline-brand-400"
      />
    );
  }

  if (prop.type === "CHECKBOX") {
    return (
      <button
        onClick={() => onChange(!value)}
        className={clsx(
          "h-5 w-5 rounded border grid place-items-center transition-colors mx-2",
          value ? "bg-brand-600 border-brand-600 text-white" : "bg-white border-slate-300 hover:border-slate-400"
        )}
      >
        {value && <Check className="h-3.5 w-3.5" />}
      </button>
    );
  }

  if (prop.type === "SELECT") {
    const options: { label: string; color: string }[] = prop.config?.options ?? [];
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full text-sm px-2 py-1 bg-transparent rounded hover:bg-slate-50 focus:outline focus:outline-2 focus:outline-brand-400"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.label} value={o.label}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (prop.type === "MULTI_SELECT") {
    const options: { label: string; color: string }[] = prop.config?.options ?? [];
    const current: string[] = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-1 px-2 py-1">
        {options.map((o) => {
          const active = current.includes(o.label);
          return (
            <button
              key={o.label}
              onClick={() => {
                const next = active ? current.filter((x) => x !== o.label) : [...current, o.label];
                onChange(next);
              }}
              className={clsx(
                "text-[11px] px-1.5 py-0.5 rounded border",
                active ? `${o.color} border-transparent text-slate-800` : "bg-white border-slate-200 text-slate-400"
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  return <div className="text-xs text-slate-400 px-2 py-1">Tipo {prop.type} no soportado</div>;
}

export function SelectChip({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className={clsx(
        "inline-block text-[11px] px-1.5 py-0.5 rounded",
        color ?? "bg-slate-100 text-slate-700"
      )}
    >
      {label}
    </span>
  );
}
