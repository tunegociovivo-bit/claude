"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, KanbanSquare, Users, BookOpen, CalendarDays, Database, Settings, Sparkles, Plus, FolderKanban } from "lucide-react";
import clsx from "clsx";
import ProjectFormModal from "@/components/forms/ProjectFormModal";
import type { UiClient } from "@/lib/db/queries";

const nav = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/tareas", label: "Tareas", icon: KanbanSquare },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/documentos", label: "Documentos", icon: BookOpen },
  { href: "/databases", label: "Bases de datos", icon: Database },
  { href: "/calendario", label: "Calendario", icon: CalendarDays }
];

type SidebarProject = { id: string; name: string; color: string };

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProjectId = searchParams.get("project");

  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const [clients, setClients] = useState<UiClient[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [me, setMe] = useState<{ name: string | null; email: string; role: string | null } | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const [pr, cr, mr] = await Promise.all([
          fetch("/api/v1/projects"),
          fetch("/api/v1/clients"),
          fetch("/api/v1/me")
        ]);
        if (!aborted && pr.ok) {
          const data = await pr.json();
          setProjects(
            (data.items ?? []).map((p: any) => ({
              id: p.id,
              name: p.name,
              color: p.color ?? "bg-brand-500"
            }))
          );
        }
        if (!aborted && cr.ok) {
          const data = await cr.json();
          setClients(data.items ?? []);
        }
        if (!aborted && mr.ok) {
          const data = await mr.json();
          if (data.user) {
            setMe({ name: data.user.name, email: data.user.email, role: data.role });
          }
        }
      } catch {
        // silencio: si no hay sesión, no mostramos proyectos
      }
    })();
    return () => {
      aborted = true;
    };
  }, [newProjectOpen]); // refetch tras cerrar modal

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

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {nav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                active && !activeProjectId
                  ? "bg-brand-50 text-brand-700 font-medium"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        <div className="pt-4 mt-2 border-t border-slate-100">
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold flex items-center gap-1.5">
              <FolderKanban className="h-3 w-3" />
              Proyectos
            </span>
            <button
              onClick={() => setNewProjectOpen(true)}
              className="h-5 w-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Nuevo proyecto"
              title="Nuevo proyecto"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-0.5">
            {projects.map((p) => {
              const active = activeProjectId === p.id;
              return (
                <Link
                  key={p.id}
                  href={`/tareas?project=${p.id}`}
                  className={clsx(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors",
                    active
                      ? "bg-brand-50 text-brand-700 font-medium"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <span className={`h-2 w-2 rounded-full ${p.color}`} />
                  <span className="truncate">{p.name}</span>
                </Link>
              );
            })}
            {projects.length === 0 && (
              <button
                onClick={() => setNewProjectOpen(true)}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded"
              >
                + Crea tu primer proyecto
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="border-t p-3">
        <Link
          href="/admin"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
        >
          <Settings className="h-4 w-4" />
          Administración
        </Link>
        <Link
          href="/admin/usuarios"
          className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50"
        >
          <div className="h-8 w-8 rounded-full bg-brand-500 text-white grid place-items-center text-xs font-semibold">
            {me ? initialsFromName(me.name ?? me.email) : "?"}
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-sm font-medium truncate">{me?.name ?? me?.email ?? "Cargando…"}</div>
            <div className="text-xs text-slate-500">
              {me?.role === "ADMIN" ? "Administrador" : me?.role === "MEMBER" ? "Miembro" : me?.role === "GUEST" ? "Invitado" : ""}
            </div>
          </div>
        </Link>
      </div>

      <ProjectFormModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        clients={clients}
      />
    </aside>
  );
}

function initialsFromName(s: string): string {
  return s
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
