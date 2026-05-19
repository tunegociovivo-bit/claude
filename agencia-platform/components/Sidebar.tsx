"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  UsersRound,
  BookOpen,
  CalendarDays,
  Database,
  Settings,
  Sparkles,
  Plus,
  FolderKanban,
  AppWindow,
  Star,
  Mic,
  FileText,
  Download,
  MessageSquare,
  ArrowUp,
  ArrowDown,
  Trash2,
  Sunrise
} from "lucide-react";
import clsx from "clsx";
import ProjectFormModal from "@/components/forms/ProjectFormModal";
import DeleteProjectModal from "@/components/projects/DeleteProjectModal";
import type { UiClient } from "@/lib/db/queries";

type SidebarPlatform = { key: string; label: string; href: string };

const PLATFORM_ICONS: Record<string, typeof Star> = {
  reviews: Star,
  voice_reviews: Mic,
  redactor_ia: Sparkles,
  asana_import: Download,
  nv_dashboard: FileText,
  nv_leads: MessageSquare
};

const nav = [
  { href: "/", label: "Inicio", icon: LayoutDashboard, feature: "inicio" as const },
  { href: "/mi-dia", label: "Mi día", icon: Sunrise, feature: "inicio" as const },
  { href: "/tareas", label: "Tareas", icon: KanbanSquare, feature: "tareas" as const },
  { href: "/clientes", label: "Clientes", icon: Users, feature: "clientes" as const },
  { href: "/equipo", label: "Equipo", icon: UsersRound, feature: "equipo" as const },
  { href: "/documentos", label: "Documentos", icon: BookOpen, feature: "documentos" as const },
  { href: "/databases", label: "Bases de datos", icon: Database, feature: "databases" as const },
  { href: "/calendario", label: "Calendario", icon: CalendarDays, feature: "calendario" as const }
];

type SidebarProject = {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  managerImage: string | null;
  managerName: string | null;
};

export default function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProjectId = searchParams.get("project");

  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const [clients, setClients] = useState<UiClient[]>([]);
  const [platforms, setPlatforms] = useState<SidebarPlatform[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);
  const [me, setMe] = useState<{ name: string | null; email: string; image: string | null; role: string | null; features: string[] } | null>(null);
  const [workspace, setWorkspace] = useState<{ name: string; logo: string | null } | null>(null);

  // Orden custom por usuario (localStorage)
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const [platformOrder, setPlatformOrder] = useState<string[]>([]);
  const [usage, setUsage] = useState<{
    projects: Record<string, number>;
    platforms: Record<string, number>;
    maxMicros: number;
  }>({ projects: {}, platforms: {}, maxMicros: 0 });

  // Cargar orden de localStorage al montar
  useEffect(() => {
    try {
      const p = localStorage.getItem("sidebar-projects-order-v1");
      if (p) setProjectOrder(JSON.parse(p));
      const pl = localStorage.getItem("sidebar-platforms-order-v1");
      if (pl) setPlatformOrder(JSON.parse(pl));
    } catch {}
  }, []);

  function moveProject(id: string, dir: -1 | 1) {
    const ids = orderItems(projects.map((p) => p.id), projectOrder);
    const idx = ids.indexOf(id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    setProjectOrder(ids);
    try { localStorage.setItem("sidebar-projects-order-v1", JSON.stringify(ids)); } catch {}
  }

  function movePlatform(key: string, dir: -1 | 1) {
    const keys = orderItems(platforms.map((p) => p.key), platformOrder);
    const idx = keys.indexOf(key);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= keys.length) return;
    [keys[idx], keys[newIdx]] = [keys[newIdx], keys[idx]];
    setPlatformOrder(keys);
    try { localStorage.setItem("sidebar-platforms-order-v1", JSON.stringify(keys)); } catch {}
  }

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const [pr, cr, mr, plr, wr, ur] = await Promise.all([
          fetch("/api/v1/projects"),
          fetch("/api/v1/clients"),
          fetch("/api/v1/me"),
          fetch("/api/v1/platforms"),
          fetch("/api/v1/workspace"),
          fetch("/api/v1/sidebar-usage")
        ]);
        if (!aborted && ur.ok) {
          const data = await ur.json();
          const projMap: Record<string, number> = {};
          const platMap: Record<string, number> = {};
          (data.projects ?? []).forEach((p: any) => (projMap[p.id] = p.micros));
          (data.platforms ?? []).forEach((p: any) => (platMap[p.key] = p.micros));
          setUsage({ projects: projMap, platforms: platMap, maxMicros: data.maxMicros ?? 0 });
        }
        if (!aborted && wr.ok) {
          const d = await wr.json();
          if (d) setWorkspace({ name: d.name, logo: d.logo });
        }
        if (!aborted && pr.ok) {
          const data = await pr.json();
          setProjects(
            (data.items ?? []).map((p: any) => ({
              id: p.id,
              name: p.name,
              color: p.color ?? "bg-brand-500",
              emoji: p.emoji ?? null,
              managerImage: p.manager?.image ?? null,
              managerName: p.manager?.name ?? null
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
            setMe({
              name: data.user.name,
              email: data.user.email,
              image: data.user.image ?? null,
              role: data.role,
              features: Array.isArray(data.features) ? data.features : []
            });
          }
        }
        if (!aborted && plr.ok) {
          const data = await plr.json();
          setPlatforms(data.items ?? []);
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
    <aside className="w-72 md:w-64 shrink-0 border-r bg-white flex flex-col h-screen overflow-y-auto">
      <Link onClick={onNavigate} href="/" className="h-16 flex items-center gap-2 px-5 border-b hover:bg-slate-50">
        {workspace?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={workspace.logo}
            alt={workspace.name}
            className="h-9 w-9 rounded-lg object-cover"
          />
        ) : (
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white">
            <Sparkles className="h-5 w-5" />
          </div>
        )}
        <div className="leading-tight min-w-0">
          <div className="text-sm font-semibold truncate">{workspace?.name ?? "Hub"}</div>
          <div className="text-xs text-slate-500">Plataforma interna</div>
        </div>
      </Link>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {nav
          .filter((item) => {
            // Mientras /me no haya respondido aún (me === null), mostramos
            // todo para no parpadear. Cuando llegue, filtramos por features.
            if (!me) return true;
            return me.features.includes(item.feature);
          })
          .map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link onClick={onNavigate}
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
            {orderItems(projects.map((p) => p.id), projectOrder).map((id, idx, arr) => {
              const p = projects.find((x) => x.id === id);
              if (!p) return null;
              const active = activeProjectId === p.id;
              const cost = usage.projects[p.id] ?? 0;
              return (
                <div key={p.id} className="group flex items-center gap-1">
                  <Link
                    onClick={onNavigate}
                    href={`/tareas?project=${p.id}`}
                    className={clsx(
                      "flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors min-w-0",
                      active
                        ? "bg-brand-50 text-brand-700 font-medium"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    {/* Prioridad visual: foto del manager > emoji > puntito color.
                        Si el proyecto tiene un gestor con foto, esa es la señal
                        más fuerte de identidad — supera al emoji/color. */}
                    {p.managerImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.managerImage}
                        alt={p.managerName ?? ""}
                        title={p.managerName ? `Gestor: ${p.managerName}` : undefined}
                        className="h-5 w-5 rounded-full object-cover shrink-0 border border-white"
                      />
                    ) : p.emoji ? (
                      <span className="text-base leading-none shrink-0 w-5 text-center">
                        {p.emoji}
                      </span>
                    ) : (
                      <span className={`h-2 w-2 rounded-full ${p.color} shrink-0`} />
                    )}
                    <span className="truncate flex-1">{p.name}</span>
                    <UsageBar micros={cost} max={usage.maxMicros} />
                  </Link>
                  <div className="hidden group-hover:flex flex-col -mx-0.5">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); moveProject(p.id, -1); }}
                      disabled={idx === 0}
                      className="h-3 w-4 grid place-items-center rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"
                      title="Subir"
                    >
                      <ArrowUp className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); moveProject(p.id, 1); }}
                      disabled={idx === arr.length - 1}
                      className="h-3 w-4 grid place-items-center rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"
                      title="Bajar"
                    >
                      <ArrowDown className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  {me?.role === "ADMIN" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setProjectToDelete({ id: p.id, name: p.name });
                      }}
                      className="hidden group-hover:grid h-5 w-5 place-items-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                      title="Eliminar proyecto"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
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

        {(platforms.length > 0 || me?.role === "ADMIN") && (
          <div className="pt-4 mt-2 border-t border-slate-100">
            <div className="flex items-center justify-between px-3 mb-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold flex items-center gap-1.5">
                <AppWindow className="h-3 w-3" />
                Plataformas
              </span>
              {me?.role === "ADMIN" && (
                <Link onClick={onNavigate}
                  href="/admin/plataformas"
                  className="h-5 w-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="Configurar plataformas"
                >
                  <Settings className="h-3 w-3" />
                </Link>
              )}
            </div>
            <div className="space-y-0.5">
              {orderItems(platforms.map((p) => p.key), platformOrder).map((key, idx, arr) => {
                const p = platforms.find((x) => x.key === key);
                if (!p) return null;
                const Icon = PLATFORM_ICONS[p.key] ?? Sparkles;
                const active = pathname.startsWith(p.href);
                const cost = usage.platforms[p.key] ?? 0;
                return (
                  <div key={p.key} className="group flex items-center gap-1">
                    <Link
                      onClick={onNavigate}
                      href={p.href}
                      className={clsx(
                        "flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors min-w-0",
                        active
                          ? "bg-brand-50 text-brand-700 font-medium"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate flex-1">{p.label}</span>
                      <UsageBar micros={cost} max={usage.maxMicros} />
                    </Link>
                    <div className="hidden group-hover:flex flex-col -mx-0.5">
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); movePlatform(p.key, -1); }}
                        disabled={idx === 0}
                        className="h-3 w-4 grid place-items-center rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        title="Subir"
                      >
                        <ArrowUp className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); movePlatform(p.key, 1); }}
                        disabled={idx === arr.length - 1}
                        className="h-3 w-4 grid place-items-center rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        title="Bajar"
                      >
                        <ArrowDown className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {platforms.length === 0 && me?.role === "ADMIN" && (
                <Link onClick={onNavigate}
                  href="/admin/plataformas"
                  className="block px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded"
                >
                  Activa una plataforma →
                </Link>
              )}
            </div>
          </div>
        )}
      </nav>

      <div className="border-t p-3">
        <Link onClick={onNavigate}
          href="/admin"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
        >
          <Settings className="h-4 w-4" />
          Administración
        </Link>
        <Link onClick={onNavigate}
          href="/perfil"
          className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50"
        >
          {me?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.image} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-brand-500 text-white grid place-items-center text-xs font-semibold">
              {me ? initialsFromName(me.name ?? me.email) : "?"}
            </div>
          )}
          <div className="leading-tight min-w-0">
            <div className="text-sm font-medium truncate">{me?.name ?? me?.email ?? "Cargando…"}</div>
            <div className="text-xs text-slate-500">
              {me?.role === "ADMIN" ? "Administrador" : me?.role === "MEMBER" ? "Miembro" : me?.role === "GUEST" ? "Invitado" : ""}
            </div>
          </div>
        </Link>
      </div>

      <VersionBadge />

      <ProjectFormModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        clients={clients}
      />
      <DeleteProjectModal
        open={!!projectToDelete}
        project={projectToDelete}
        allProjects={projects.map((p) => ({ id: p.id, name: p.name }))}
        onClose={() => setProjectToDelete(null)}
        onDeleted={() => {
          setProjectToDelete(null);
          location.href = "/tareas";
        }}
      />
    </aside>
  );
}

/**
 * Aplica el orden custom guardado y deja al final cualquier item nuevo que
 * no estuviera en el orden persistido.
 */
function orderItems(allIds: string[], savedOrder: string[]): string[] {
  if (savedOrder.length === 0) return allIds;
  const set = new Set(allIds);
  const present = savedOrder.filter((id) => set.has(id));
  const missing = allIds.filter((id) => !present.includes(id));
  return [...present, ...missing];
}

/**
 * Barra visual de consumo IA semanal relativa al máximo del workspace.
 * Verde < 33%, ámbar < 66%, rojo si más.
 */
function UsageBar({ micros, max }: { micros: number; max: number }) {
  if (!micros || !max) return null;
  const pct = Math.min(100, Math.round((micros / max) * 100));
  const color =
    pct < 33 ? "bg-emerald-400" : pct < 66 ? "bg-amber-400" : "bg-rose-500";
  const usd = (micros / 1_000_000).toFixed(2);
  return (
    <span
      title={`Consumo IA esta semana: $${usd}`}
      className="ml-auto flex items-center gap-0.5"
    >
      <span className="h-1 w-8 bg-slate-200 rounded overflow-hidden">
        <span className={`block h-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
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

/**
 * Mini badge en la parte inferior izquierda del sidebar con la
 * versión del CRM que se está sirviendo ahora mismo (SHA corto +
 * rama). Si Railway todavía no terminó el deploy, este badge sigue
 * mostrando el commit anterior — así sabes a simple vista si la
 * página que estás viendo ya incluye tu último push o no.
 *
 * Hover muestra el SHA completo y el branch. Click sobre el badge
 * fuerza un re-fetch (sin recargar la página) para verificar tras
 * un deploy reciente.
 */
type VersionInfo = {
  commitShort: string;
  commit: string;
  branch: string | null;
  buildTimestamp: number | null;
  buildIso: string | null;
};

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "ahora mismo";
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

function formatDayHour(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function VersionBadge() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  // Tick para que el "hace X min" se actualice solo cada minuto.
  const [, setTick] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/version", { cache: "no-store" });
      if (r.ok) setInfo(await r.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="px-3 py-2 border-t bg-slate-50 text-[10px] text-slate-500 shrink-0">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        title={
          info
            ? `Commit: ${info.commit}\nBranch: ${info.branch ?? "—"}\nBuild: ${
                info.buildIso ?? "?"
              }\nClick para refrescar`
            : "Cargando versión…"
        }
        className="font-mono hover:text-slate-800 truncate w-full text-left disabled:opacity-50 leading-tight"
      >
        <div>
          v {info?.commitShort ?? "?"}
          {info?.branch && info.branch !== "main" && (
            <span className="ml-1.5 text-slate-400">· {info.branch.slice(0, 16)}</span>
          )}
          {loading && <span className="ml-1.5">…</span>}
        </div>
        {info?.buildTimestamp && (
          <div className="text-slate-400 mt-0.5">
            {formatDayHour(info.buildTimestamp)} · {formatRelative(info.buildTimestamp)}
          </div>
        )}
      </button>
    </div>
  );
}
