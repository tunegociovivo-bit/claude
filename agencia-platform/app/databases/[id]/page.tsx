"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, LayoutGrid, Table as TableIcon, CalendarDays, Plus, Loader2 } from "lucide-react";
import clsx from "clsx";
import TableView from "@/components/databases/TableView";
import BoardView from "@/components/databases/BoardView";
import CalendarView from "@/components/databases/CalendarView";
import PropertyEditor from "@/components/databases/PropertyEditor";
import type { DbDetail, DbRecord, DbView, DbProperty } from "@/lib/db/types";

const viewIcons: Record<string, any> = {
  TABLE: TableIcon,
  BOARD: LayoutGrid,
  CALENDAR: CalendarDays
};

export default function DatabasePage() {
  const params = useParams<{ id: string }>();
  const [db, setDb] = useState<DbDetail | null>(null);
  const [records, setRecords] = useState<DbRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [editingProp, setEditingProp] = useState<DbProperty | null>(null);
  const [creatingProp, setCreatingProp] = useState(false);

  async function loadDb() {
    const [a, b] = await Promise.all([
      fetch(`/api/v1/databases/${params.id}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/v1/databases/${params.id}/records`).then((r) => (r.ok ? r.json() : { items: [] }))
    ]);
    setDb(a);
    setRecords(b.items ?? []);
    if (a?.views?.length) setActiveViewId((prev) => prev ?? a.views[0].id);
    setLoading(false);
  }

  useEffect(() => {
    loadDb();
  }, [params.id]);

  const activeView = useMemo<DbView | null>(
    () => db?.views.find((v) => v.id === activeViewId) ?? db?.views[0] ?? null,
    [db, activeViewId]
  );

  async function updateValue(recordId: string, propertyId: string, value: any) {
    setRecords((prev) =>
      prev.map((r) => (r.id === recordId ? { ...r, values: { ...r.values, [propertyId]: value } } : r))
    );
    await fetch(`/api/v1/databases/${params.id}/records/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: { [propertyId]: value } })
    });
  }

  async function updateTitle(recordId: string, title: string) {
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, title } : r)));
    await fetch(`/api/v1/databases/${params.id}/records/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
  }

  async function addRecord(initialValues: Record<string, any> = {}) {
    const r = await fetch(`/api/v1/databases/${params.id}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nuevo registro", values: initialValues })
    });
    if (r.ok) await loadDb();
  }

  async function deleteRecord(recordId: string) {
    if (!confirm("¿Eliminar este registro?")) return;
    await fetch(`/api/v1/databases/${params.id}/records/${recordId}`, { method: "DELETE" });
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
  }

  async function saveProperty(data: Partial<DbProperty>) {
    if (editingProp) {
      await fetch(`/api/v1/databases/${params.id}/properties/${editingProp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
    } else {
      await fetch(`/api/v1/databases/${params.id}/properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
    }
    await loadDb();
  }

  async function deleteProperty() {
    if (!editingProp) return;
    await fetch(`/api/v1/databases/${params.id}/properties/${editingProp.id}`, { method: "DELETE" });
    await loadDb();
  }

  async function addView(type: "TABLE" | "BOARD" | "CALENDAR") {
    const r = await fetch(`/api/v1/databases/${params.id}/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: { TABLE: "Tabla", BOARD: "Tablero", CALENDAR: "Calendario" }[type], type })
    });
    if (r.ok) {
      const created = await r.json();
      await loadDb();
      setActiveViewId(created.id);
    }
  }

  async function updateViewConfig(patch: any) {
    if (!activeView) return;
    const config = { ...(activeView.config ?? {}), ...patch };
    await fetch(`/api/v1/databases/${params.id}/views/${activeView.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config })
    });
    setDb((d) =>
      d ? { ...d, views: d.views.map((v) => (v.id === activeView.id ? { ...v, config } : v)) } : d
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando base de datos…
      </div>
    );
  }
  if (!db) {
    return (
      <div className="max-w-7xl mx-auto text-sm text-slate-500">
        No se ha podido cargar la base de datos. ¿Está la BD configurada?
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <Link
        href="/databases"
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Bases de datos
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="text-3xl">{db.icon ?? "🗂️"}</div>
        <h1 className="text-2xl font-semibold tracking-tight">{db.name}</h1>
      </div>

      <div className="flex items-center justify-between border-b mb-4">
        <div className="flex">
          {db.views.map((v) => {
            const Icon = viewIcons[v.type] ?? TableIcon;
            const active = v.id === activeViewId;
            return (
              <button
                key={v.id}
                onClick={() => setActiveViewId(v.id)}
                className={clsx(
                  "px-3 py-2 text-sm inline-flex items-center gap-1.5 border-b-2 -mb-px",
                  active
                    ? "border-brand-600 text-brand-700 font-medium"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.name}
              </button>
            );
          })}
          <div className="relative">
            <details className="group">
              <summary className="list-none px-3 py-2 text-sm text-slate-500 hover:text-slate-900 cursor-pointer">
                <Plus className="h-3.5 w-3.5 inline" /> Vista
              </summary>
              <div className="absolute mt-1 z-10 bg-white border rounded-lg shadow-lg p-1 w-44">
                {(["TABLE", "BOARD", "CALENDAR"] as const).map((t) => {
                  const Icon = viewIcons[t];
                  return (
                    <button
                      key={t}
                      onClick={() => addView(t)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-slate-50"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {{ TABLE: "Tabla", BOARD: "Tablero", CALENDAR: "Calendario" }[t]}
                    </button>
                  );
                })}
              </div>
            </details>
          </div>
        </div>
        <button
          onClick={() => addRecord()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo
        </button>
      </div>

      {activeView?.type === "TABLE" && (
        <TableView
          db={db}
          records={records}
          onUpdateValue={updateValue}
          onUpdateTitle={updateTitle}
          onDeleteRecord={deleteRecord}
          onAddRecord={() => addRecord()}
          onAddProperty={() => {
            setEditingProp(null);
            setCreatingProp(true);
          }}
          onEditProperty={(pid) => {
            const p = db.properties.find((x) => x.id === pid);
            if (p) setEditingProp(p);
          }}
        />
      )}

      {activeView?.type === "BOARD" && (
        <BoardView
          db={db}
          records={records}
          groupBy={activeView.config?.groupBy ?? null}
          onChangeGroup={(pid) => updateViewConfig({ groupBy: pid })}
          onMoveRecord={(rid, value) => {
            const groupBy =
              activeView.config?.groupBy ?? db.properties.find((p) => p.type === "SELECT")?.id;
            if (groupBy) updateValue(rid, groupBy, value);
          }}
          onAddRecord={(value) => {
            const groupBy =
              activeView.config?.groupBy ?? db.properties.find((p) => p.type === "SELECT")?.id;
            addRecord(groupBy && value ? { [groupBy]: value } : {});
          }}
        />
      )}

      {activeView?.type === "CALENDAR" && (
        <CalendarView
          db={db}
          records={records}
          dateProperty={activeView.config?.dateProperty ?? null}
          onChangeDateProperty={(pid) => updateViewConfig({ dateProperty: pid })}
        />
      )}

      {(editingProp || creatingProp) && (
        <PropertyEditor
          property={editingProp}
          onClose={() => {
            setEditingProp(null);
            setCreatingProp(false);
          }}
          onSave={saveProperty}
          onDelete={editingProp ? deleteProperty : undefined}
        />
      )}
    </div>
  );
}
