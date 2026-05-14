"use client";

import { Plus, Trash2, Settings2 } from "lucide-react";
import Cell from "./Cell";
import type { DbDetail, DbRecord } from "@/lib/db/types";

export default function TableView({
  db,
  records,
  onUpdateValue,
  onUpdateTitle,
  onDeleteRecord,
  onAddRecord,
  onAddProperty,
  onEditProperty
}: {
  db: DbDetail;
  records: DbRecord[];
  onUpdateValue: (recordId: string, propertyId: string, value: any) => void;
  onUpdateTitle: (recordId: string, title: string) => void;
  onDeleteRecord: (recordId: string) => void;
  onAddRecord: () => void;
  onAddProperty: () => void;
  onEditProperty: (propertyId: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b">
          <tr>
            <th className="text-left px-5 py-3 min-w-[240px] sticky left-0 bg-slate-50">Título</th>
            {db.properties.map((p) => (
              <th key={p.id} className="text-left px-3 py-3 min-w-[160px]">
                <button
                  onClick={() => onEditProperty(p.id)}
                  className="flex items-center gap-1.5 hover:text-slate-900"
                >
                  {p.name}
                  <Settings2 className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                </button>
                <div className="text-[10px] font-normal normal-case text-slate-400 mt-0.5">
                  {p.type.toLowerCase().replace("_", " ")}
                </div>
              </th>
            ))}
            <th className="text-left px-2 py-3 w-12">
              <button
                onClick={onAddProperty}
                className="h-6 w-6 grid place-items-center rounded hover:bg-slate-100 text-slate-500"
                title="Añadir columna"
              >
                <Plus className="h-4 w-4" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50/60 group">
              <td className="px-5 py-1 sticky left-0 bg-white group-hover:bg-slate-50/60">
                <input
                  defaultValue={r.title}
                  onBlur={(e) => {
                    if (e.target.value !== r.title) onUpdateTitle(r.id, e.target.value);
                  }}
                  className="w-full px-2 py-1 text-sm font-medium bg-transparent rounded hover:bg-slate-50 focus:outline focus:outline-2 focus:outline-brand-400"
                />
              </td>
              {db.properties.map((p) => (
                <td key={p.id} className="px-1 py-1">
                  <Cell
                    prop={p}
                    value={r.values[p.id]}
                    onChange={(v) => onUpdateValue(r.id, p.id, v)}
                  />
                </td>
              ))}
              <td className="px-2 py-1">
                <button
                  onClick={() => onDeleteRecord(r.id)}
                  className="opacity-0 group-hover:opacity-100 h-6 w-6 grid place-items-center rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={db.properties.length + 2} className="px-5 py-2">
              <button
                onClick={onAddRecord}
                className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo registro
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
