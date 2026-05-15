"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell, Plus, KanbanSquare, Users, FolderPlus, CalendarPlus } from "lucide-react";
import TaskFormModal from "@/components/forms/TaskFormModal";
import ClientFormModal from "@/components/forms/ClientFormModal";
import EventFormModal from "@/components/forms/EventFormModal";
import ProjectFormModal from "@/components/forms/ProjectFormModal";
import type { UiClient, UiProject, UiMember } from "@/lib/db/queries";

type TopBarMember = { id: string; name: string; image?: string | null; initials: string; color: string };

export default function TopBar() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [taskOpen, setTaskOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const [clients, setClients] = useState<UiClient[]>([]);
  const [projects, setProjects] = useState<UiProject[]>([]);
  const [team, setTeam] = useState<TopBarMember[]>([]);
  const [search, setSearch] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const [pr, cr, tr] = await Promise.all([
          fetch("/api/v1/projects"),
          fetch("/api/v1/clients"),
          fetch("/api/v1/users")
        ]);
        if (!aborted && pr.ok) {
          const d = await pr.json();
          setProjects(d.items ?? []);
        }
        if (!aborted && cr.ok) {
          const d = await cr.json();
          setClients(d.items ?? []);
        }
        if (!aborted && tr.ok) {
          const d = await tr.json();
          setTeam(
            (d.items ?? []).map((u: any) => ({
              id: u.id,
              name: u.name || u.email || "Usuario",
              image: u.image,
              initials: initialsFromName(u.name || u.email || "?"),
              color: colorFromString(u.id)
            }))
          );
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  // Polling cada 30s del contador de notificaciones no leídas
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/v1/notifications?unread=true");
        if (r.ok && !cancelled) {
          const d = await r.json();
          setUnreadCount(d.unreadCount ?? 0);
        }
      } catch {
        // silencio
      }
    }
    poll();
    const interval = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function open(target: "task" | "client" | "event" | "project") {
    setMenuOpen(false);
    if (target === "task") setTaskOpen(true);
    if (target === "client") setClientOpen(true);
    if (target === "event") setEventOpen(true);
    if (target === "project") setProjectOpen(true);
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = search.trim();
    if (!q) return;
    router.push(`/buscar?q=${encodeURIComponent(q)}`);
  }

  return (
    <header className="h-16 border-b bg-white flex items-center justify-between px-8">
      <div className="relative w-96 max-w-full">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Buscar tareas, clientes, documentos…"
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nuevo
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white border rounded-xl shadow-lg py-1.5 z-40">
              <MenuItem icon={<KanbanSquare className="h-4 w-4" />} label="Nueva tarea" onClick={() => open("task")} />
              <MenuItem icon={<FolderPlus className="h-4 w-4" />} label="Nuevo proyecto" onClick={() => open("project")} />
              <MenuItem icon={<Users className="h-4 w-4" />} label="Nuevo cliente" onClick={() => open("client")} />
              <MenuItem icon={<CalendarPlus className="h-4 w-4" />} label="Nuevo evento" onClick={() => open("event")} />
            </div>
          )}
        </div>

        <Link
          href="/admin/notificaciones"
          className="h-9 w-9 rounded-lg border bg-white grid place-items-center text-slate-500 hover:text-slate-900 relative"
          aria-label="Notificaciones"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold grid place-items-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>

        <Link
          href="/admin/usuarios"
          className="flex items-center gap-0 hover:opacity-90 transition"
          title="Gestionar usuarios"
        >
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
            {team.length > 4 && (
              <div className="h-8 w-8 rounded-full bg-slate-200 text-slate-600 grid place-items-center text-xs font-semibold ring-2 ring-white">
                +{team.length - 4}
              </div>
            )}
            {team.length === 0 && (
              <div className="h-8 w-8 rounded-full bg-slate-100 text-slate-400 grid place-items-center text-xs ring-2 ring-white">
                <Users className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        </Link>
      </div>

      <TaskFormModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        projects={projects}
        team={team.map((m) => ({ id: m.id, name: m.name, initials: m.initials, color: m.color, role: "" }))}
      />
      <ClientFormModal open={clientOpen} onClose={() => setClientOpen(false)} mode="create" />
      <EventFormModal open={eventOpen} onClose={() => setEventOpen(false)} clients={clients} />
      <ProjectFormModal open={projectOpen} onClose={() => setProjectOpen(false)} clients={clients} />
    </header>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2 inline-flex items-center gap-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
    >
      <span className="text-slate-500">{icon}</span>
      {label}
    </button>
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

const palette = ["bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-indigo-500", "bg-pink-500", "bg-teal-500"];
function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
