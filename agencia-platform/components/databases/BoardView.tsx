"use client";

import { Plus } from "lucide-react";
import clsx from "clsx";
import { SelectChip } from "./Cell";
import type { DbDetail, DbRecord, DbProperty } from "@/lib/db/types";

export default function BoardView({
  db,
  records,
  groupBy,
  onChangeGroup,
  onMoveRecord,
  onAddRecord
}: {
  db: DbDetail;
  records: DbRecord[];
  groupBy: string | null; // propertyId
  onChangeGroup: (propertyId: string) => void;
  onMoveRecord: (recordId: string, newValue: string | null) => void;
  onAddRecord: (groupValue: string | null) => void;
}) {
  const selectProps = db.properties.filter((p) => p.type === "SELECT");
  const groupProp = selectProps.find((p) => p.id === groupBy) ?? selectProps[0];

  if (!groupProp) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-sm text-slate-500">
        Para usar la vista tablero necesitas al menos una propiedad de tipo <strong>Select</strong>.
      </div>
    );
  }

  const options: { label: string; color: string }[] = groupProp.config?.options ?? [];
  const columns = [...options, { label: "Sin asignar", color: "bg-slate-100" }];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Agrupar por:</span>
        <select
          value={groupProp.id}
          onChange={(e) => onChangeGroup(e.target.value)}
          className="px-2 py-1 rounded-md bg-white border text-xs font-medium"
        >
          {selectProps.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-3">
        {columns.map((col) => {
          const colValue = col.label === "Sin asignar" ? null : col.label;
          const colRecords = records.filter((r) => {
            const v = r.values[groupProp.id];
            return colValue === null ? !v : v === colValue;
          });
          return (
            <div key={col.label} className="bg-slate-100/60 rounded-xl p-3 w-72 shrink-0">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <SelectChip label={col.label} color={col.color} />
                  <span className="text-xs text-slate-500">{colRecords.length}</span>
                </div>
                <button
                  onClick={() => onAddRecord(colValue)}
                  className="text-slate-400 hover:text-slate-700"
                  title="Añadir tarjeta"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2">
                {colRecords.map((r) => (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/recordId", r.id)}
                    className="bg-white rounded-lg border p-3 cursor-grab active:cursor-grabbing hover:shadow-sm"
                  >
                    <div className="text-sm font-medium leading-snug">{r.title}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {db.properties
                        .filter((p) => p.id !== groupProp.id && r.values[p.id] != null && r.values[p.id] !== "")
                        .slice(0, 3)
                        .map((p) => (
                          <RecordChip key={p.id} prop={p} value={r.values[p.id]} />
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/recordId");
                  if (id) onMoveRecord(id, colValue);
                }}
                className="h-10 mt-2 rounded border border-dashed border-transparent hover:border-slate-300"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordChip({ prop, value }: { prop: DbProperty; value: any }) {
  if (prop.type === "SELECT") {
    const opt = (prop.config?.options ?? []).find((o: any) => o.label === value);
    return <SelectChip label={value} color={opt?.color} />;
  }
  if (prop.type === "DATE") {
    return (
      <span className="text-[10px] text-slate-500">
        {new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
      </span>
    );
  }
  if (prop.type === "CHECKBOX") {
    return <span className="text-[10px] text-slate-500">{value ? "✓" : "·"} {prop.name}</span>;
  }
  if (prop.type === "MULTI_SELECT" && Array.isArray(value)) {
    return (
      <>
        {value.slice(0, 2).map((v) => {
          const opt = (prop.config?.options ?? []).find((o: any) => o.label === v);
          return <SelectChip key={v} label={v} color={opt?.color} />;
        })}
      </>
    );
  }
  return <span className="text-[10px] text-slate-500 truncate max-w-[140px]">{String(value)}</span>;
}
