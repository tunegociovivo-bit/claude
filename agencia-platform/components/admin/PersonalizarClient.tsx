"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  UsersRound,
  BookOpen,
  CalendarDays,
  Database,
  Sunrise,
  Receipt,
  FolderKanban,
  AppWindow,
  Eye,
  EyeOff
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { readHiddenNav, writeHiddenNav } from "@/lib/ui/hidden-nav";

type Item = {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const MAIN_TABS: Item[] = [
  { key: "/", label: "Inicio", icon: LayoutDashboard },
  { key: "/mi-dia", label: "Mi día", icon: Sunrise },
  { key: "/tareas", label: "Tareas", icon: KanbanSquare },
  { key: "/clientes", label: "Clientes", icon: Users },
  { key: "/equipo", label: "Equipo", icon: UsersRound },
  { key: "/documentos", label: "Documentos", icon: BookOpen },
  { key: "/databases", label: "Bases de datos", icon: Database },
  { key: "/calendario", label: "Calendario", icon: CalendarDays }
];

const SECTIONS: Item[] = [
  { key: "facturacion", label: "Facturación", icon: Receipt },
  { key: "section:proyectos", label: "Proyectos (sección entera)", icon: FolderKanban },
  { key: "section:plataformas", label: "Plataformas (sección entera)", icon: AppWindow }
];

export default function PersonalizarClient() {
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    setHidden(readHiddenNav());
  }, []);

  function toggle(key: string) {
    setHidden((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      writeHiddenNav(next);
      return next;
    });
  }

  function resetAll() {
    writeHiddenNav([]);
    setHidden([]);
  }

  function renderRow(item: Item) {
    const Icon = item.icon;
    const isHidden = hidden.includes(item.key);
    return (
      <div
        key={item.key}
        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border bg-white"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon className={"h-4 w-4 shrink-0 " + (isHidden ? "text-slate-300" : "text-slate-600")} />
          <span className={"text-sm truncate " + (isHidden ? "text-slate-400 line-through" : "text-slate-800")}>
            {item.label}
          </span>
        </div>
        <button
          type="button"
          onClick={() => toggle(item.key)}
          className={
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border " +
            (isHidden
              ? "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
              : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100")
          }
          title={isHidden ? "Mostrar en el menú" : "Ocultar del menú"}
        >
          {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {isHidden ? "Oculta" : "Visible"}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Personalizar Hub" />
      <div className="mb-4 text-sm text-slate-600">
        Elige qué pestañas y secciones quieres ver en TU menú lateral. Esta
        preferencia es solo para ti (no afecta a otros usuarios) y se guarda
        en este navegador.
      </div>

      <div className="space-y-5">
        <section>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Pestañas principales
          </h3>
          <div className="space-y-1.5">{MAIN_TABS.map(renderRow)}</div>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Otras secciones del menú
          </h3>
          <div className="space-y-1.5">{SECTIONS.map(renderRow)}</div>
          <div className="mt-2 text-xs text-slate-500">
            Ocultar una sección entera oculta todos sus elementos (p. ej. todos
            los proyectos del menú).
          </div>
        </section>

        {hidden.length > 0 && (
          <div className="pt-2 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              {hidden.length} {hidden.length === 1 ? "elemento oculto" : "elementos ocultos"}
            </div>
            <button
              type="button"
              onClick={resetAll}
              className="text-xs px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-slate-700"
            >
              Restaurar todo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
