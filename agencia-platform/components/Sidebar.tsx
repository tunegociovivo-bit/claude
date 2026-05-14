"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, KanbanSquare, Users, BookOpen, CalendarDays, Settings, Sparkles } from "lucide-react";
import clsx from "clsx";

const nav = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/tareas", label: "Tareas", icon: KanbanSquare },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/documentos", label: "Documentos", icon: BookOpen },
  { href: "/calendario", label: "Calendario", icon: CalendarDays }
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r bg-white flex flex-col">
      <div className="h-16 flex items-center gap-2 px-5 border-b">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Agencia Hub</div>
          <div className="text-xs text-slate-500">Plataforma interna</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                active
                  ? "bg-brand-50 text-brand-700 font-medium"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <Link
          href="#"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
        >
          <Settings className="h-4 w-4" />
          Configuración
        </Link>
        <div className="mt-3 flex items-center gap-3 px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-rose-500 text-white grid place-items-center text-xs font-semibold">
            LF
          </div>
          <div className="leading-tight">
            <div className="text-sm font-medium">Lucía Fernández</div>
            <div className="text-xs text-slate-500">Directora</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
