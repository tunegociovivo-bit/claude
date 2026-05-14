"use client";

import { Search, Bell, Plus } from "lucide-react";
import { team } from "@/lib/mock-data";

export default function TopBar() {
  return (
    <header className="h-16 border-b bg-white flex items-center justify-between px-8">
      <div className="relative w-96 max-w-full">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar tareas, clientes, documentos…"
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
      </div>

      <div className="flex items-center gap-3">
        <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
          <Plus className="h-4 w-4" />
          Nuevo
        </button>
        <button className="h-9 w-9 rounded-lg border bg-white grid place-items-center text-slate-500 hover:text-slate-900 relative">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" />
        </button>
        <div className="flex -space-x-2">
          {team.slice(0, 4).map((m) => (
            <div
              key={m.id}
              className={`h-8 w-8 rounded-full ${m.color} text-white grid place-items-center text-xs font-semibold ring-2 ring-white`}
              title={m.name}
            >
              {m.initials}
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
