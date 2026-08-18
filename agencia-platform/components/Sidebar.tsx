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
  Sunrise,
  Receipt,
  MapPin,
  Building2,
  Megaphone,
  Puzzle,
  Store,
  Landmark,
  Repeat,
  Activity,
  AlertTriangle
} from "lucide-react";

// Áreas de la plataforma Bubui accesibles desde "Otros Proyectos".
const BUBUI_LINKS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/bubui", label: "Inicio (landing)", exact: true },
  { href: "/bubui/app", label: "App cliente" },
  { href: "/bubui/negocio", label: "Panel del negocio" },
  { href: "/bubui/registro", label: "Alta de negocio" },
  { href: "/bubui/admin", label: "Admin Bubui" }
];

import clsx from "clsx";
import ProjectFormModal from "@/components/forms/ProjectFormModal";
import DeleteProjectModal from "@/components/projects/DeleteProjectModal";
import type { UiClient } from "@/lib/db/queries";
import { readHiddenNav, subscribeHiddenNav } from "@/lib/ui/hidden-nav";

type SidebarPlatform = { key: string; label: string; href: string };

const PLATFORM_ICONS: Record<string, typeof Star> = {
  reviews: Star,
  voice_reviews: Mic,
  redactor_ia: Sparkles,
  asana_import: Download,
  nv_dashboard: FileText,
  nv_leads: MessageSquare,
  meta_campaigns: Megaphone,
  chrome_extension: Puzzle,
  bubui_directorio: Store,
  subvenciones: Landmark,
  gmb_hub: Star
};

// Degradado de la insignia de cada plataforma: iconos vivos y con color en el
// menú lateral (en vez de un icono gris heredando el color del texto).
const PLATFORM_GRAD: Record<string, string> = {
  reviews: "linear-gradient(135deg,#FBBF24,#F59E0B)",          // ámbar
  voice_reviews: "linear-gradient(135deg,#FB7185,#E11D48)",    // rosa
  redactor_ia: "linear-gradient(135deg,#A78BFA,#7C3AED)",      // violeta
  asana_import: "linear-gradient(135deg,#FB923C,#EA580C)",     // naranja
  nv_dashboard: "linear-gradient(135deg,#38BDF8,#2563EB)",     // azul
  nv_leads: "linear-gradient(135deg,#34D399,#059669)",         // esmeralda
  meta_campaigns: "linear-gradient(135deg,#60A5FA,#4F46E5)",   // azul-índigo (Meta)
  chrome_extension: "linear-gradient(135deg,#2DD4BF,#0D9488)", // teal
  bubui_directorio: "linear-gradient(135deg,#F86FB0,#D1186A)", // rosa Bubui
  subvenciones: "linear-gradient(135deg,#818CF8,#4338CA)",     // índigo
  gmb_hub: "linear-gradient(135deg,#34A853,#1A73E8)"           // verde-azul Google
};
const PLATFORM_GRAD_DEFAULT = "linear-gradient(135deg,#94A3B8,#475569)";

const nav = [
  { href: "/", label: "Inicio", icon: LayoutDashboard, feature: "inicio" as const },
  { href: "/mi-dia", label: "Mi día", icon: Sunrise, feature: "inicio" as const },
  // FASE 4b: bandeja de excepciones (discreta, gated por NEXT_PUBLIC_EXCEPTIONS_UI).
  { href: "/excepciones", label: "Excepciones", icon: AlertTriangle, feature: "inicio" as const },
  { href: "/tareas", label: "Tareas", icon: KanbanSquare, feature: "tareas" as const },
  { href: "/clientes", label: "Clientes", icon: Users, feature: "clientes" as const },
  { href: "/equipo", label: "Equipo", icon: UsersRound, feature: "equipo" as const },
  { href: "/documentos", label: "Documentos", icon: BookOpen, feature: "documentos" as const },
  { href: "/databases", label: "Bases de datos", icon: Database, feature: "databases" as const },
  { href: "/calendario", label: "Calendario", icon: CalendarDays, feature: "calendario" as const },
  { href: "/admin/meta-comments", label: "Comentarios Meta", icon: MessageSquare, feature: "inicio" as const }
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

  // Preferencia personal de pestañas/secciones ocultas (configurable en
  // /admin/personalizar). Reactiva: cambios en la página de personalización
  // se reflejan al instante sin recargar.
  const [hiddenNav, setHiddenNav] = useState<string[]>([]);
  useEffect(() => {
    const reload = () => setHiddenNav(readHiddenNav());
    reload();
    return subscribeHiddenNav(reload);
  }, []);
  const isHidden = (key: string) => hiddenNav.includes(key);

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
    const baseKeys = [
      ...(!me || me.features.includes("gmb") ? ["gmb_hub"] : []),
      ...platforms.map((p) => p.key)
    ];
    const keys = orderItems(baseKeys, platformOrder);
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
    // F2.5: una sola carga agregada. Si falla (o el endpoint no existiera),
    // se cae al camino de abajo con los 6 fetch individuales → sin regresión.
    async function tryAggregate(): Promise<boolean> {
      try {
        const r = await fetch("/api/v1/sidebar-bootstrap", { cache: "no-store" });
        if (!r.ok) return false;
        const d = await r.json();
        if (aborted) return true;
        if (d.usage) {
          const projMap: Record<string, number> = {};
          const platMap: Record<string, number> = {};
          (d.usage.projects ?? []).forEach((p: any) => (projMap[p.id] = p.micros));
          (d.usage.platforms ?? []).forEach((p: any) => (platMap[p.key] = p.micros));
          setUsage({ projects: projMap, platforms: platMap, maxMicros: d.usage.maxMicros ?? 0 });
        }
        if (d.workspace) setWorkspace({ name: d.workspace.name, logo: d.workspace.logo });
        setProjects(
          (d.projects?.items ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            color: p.color ?? "bg-brand-500",
            emoji: p.emoji ?? null,
            managerImage: p.manager?.image ?? null,
            managerName: p.manager?.name ?? null
          }))
        );
        setClients(d.clients?.items ?? []);
        if (d.me?.user) {
          setMe({
            name: d.me.user.name,
            email: d.me.user.email,
            image: d.me.user.image ?? null,
            role: d.me.role,
            features: Array.isArray(d.me.features) ? d.me.features : []
          });
        }
        setPlatforms(d.platforms?.items ?? []);
        return true;
      } catch {
        return false;
      }
    }
    (async () => {
      if (await tryAggregate()) return;
      try {
        const [pr, cr, mr, plr, wr, ur] = await Promise.all([
          fetch("/api/v1/projects", { cache: "no-store" }),
          fetch("/api/v1/clients", { cache: "no-store" }),
          fetch("/api/v1/me", { cache: "no-store" }),
          fetch("/api/v1/platforms", { cache: "no-store" }),
          fetch("/api/v1/workspace", { cache: "no-store" }),
          fetch("/api/v1/sidebar-usage", { cache: "no-store" })
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
    <aside className="sidebar-scroll w-72 md:w-64 shrink-0 border-r border-slate-800 bg-slate-900 text-slate-300 flex flex-col h-screen overflow-y-auto">
      <Link onClick={onNavigate} href="/" className="h-16 flex items-center gap-2 px-5 border-b border-slate-800 hover:bg-slate-800">
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
          <div className="text-sm font-semibold truncate text-white">{workspace?.name ?? "Hub"}</div>
          <div className="text-xs text-slate-400">Plataforma interna</div>
        </div>
      </Link>

      <nav className="sidebar-scroll flex-1 p-3 space-y-1 overflow-y-auto">
        {nav
          .filter((item) => {
            // Mientras /me no haya respondido aún (me === null), mostramos
            // todo para no parpadear. Cuando llegue, filtramos por features.
            if (!me) return true;
            return me.features.includes(item.feature);
          })
          // Preferencia personal: pestañas ocultadas en /admin/personalizar.
          .filter((item) => !isHidden(item.href))
          // Kill-switch de la bandeja de excepciones (FASE 4b): oculta el enlace
          // si NEXT_PUBLIC_EXCEPTIONS_UI=off. Reversible, no rompe el resto.
          .filter((item) => item.href !== "/excepciones" || process.env.NEXT_PUBLIC_EXCEPTIONS_UI !== "off")
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
                  ? "bg-brand-600/25 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {(!me || me.role === "ADMIN") && !isHidden("facturacion") && (
          <div className="pt-4 mt-2 border-t border-slate-800">
            <span className="block px-3 mb-1 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
              Facturación
            </span>
            <Link
              onClick={onNavigate}
              href="/facturacion"
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                pathname === "/facturacion"
                  ? "bg-brand-600/25 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <Receipt className="h-4 w-4" />
              Facturación
            </Link>
            <Link
              onClick={onNavigate}
              href="/admin/facturacion-recurrentes"
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                pathname.startsWith("/admin/facturacion-recurrentes")
                  ? "bg-brand-600/25 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <Repeat className="h-4 w-4" />
              Facturas recurrentes
            </Link>
            <Link
              onClick={onNavigate}
              href="/facturacion/remesas"
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                pathname.startsWith("/facturacion/remesas")
                  ? "bg-brand-600/25 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <Landmark className="h-4 w-4" />
              Remesas SEPA
            </Link>
          </div>
        )}

        {!isHidden("section:proyectos") && (
        <div className="pt-4 mt-2 border-t border-slate-800">
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold flex items-center gap-1.5">
              <FolderKanban className="h-3 w-3" />
              Proyectos
            </span>
            <button
              onClick={() => setNewProjectOpen(true)}
              className="h-5 w-5 grid place-items-center rounded text-slate-400 hover:bg-slate-800 hover:text-white"
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
                        ? "bg-brand-600/25 text-white font-medium"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
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
                        className="h-5 w-5 rounded-full object-cover shrink-0 border border-slate-700"
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
                      className="h-3 w-4 grid place-items-center rounded text-slate-500 hover:text-white disabled:opacity-30"
                      title="Subir"
                    >
                      <ArrowUp className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); moveProject(p.id, 1); }}
                      disabled={idx === arr.length - 1}
                      className="h-3 w-4 grid place-items-center rounded text-slate-500 hover:text-white disabled:opacity-30"
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
                      className="hidden group-hover:grid h-5 w-5 place-items-center rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950 shrink-0"
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
                className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 rounded"
              >
                + Crea tu primer proyecto
              </button>
            )}
          </div>
        </div>
        )}

        {!isHidden("section:plataformas") && (() => {
          const showGmb = !me || me.features.includes("gmb");
          const gmbActive = pathname.startsWith("/gmb-hub");
          return (platforms.length > 0 || showGmb || me?.role === "ADMIN") && (
          <div className="pt-4 mt-2 border-t border-slate-800">
            <div className="flex items-center justify-between px-3 mb-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold flex items-center gap-1.5">
                <AppWindow className="h-3 w-3" />
                Plataformas
              </span>
              {me?.role === "ADMIN" && (
                <Link onClick={onNavigate}
                  href="/admin/plataformas"
                  className="h-5 w-5 grid place-items-center rounded text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="Configurar plataformas"
                >
                  <Settings className="h-3 w-3" />
                </Link>
              )}
            </div>
            <div className="space-y-0.5">
              {(() => {
                const allItems = [
                  ...(showGmb ? [{ key: "gmb_hub", label: "GMB Hub", href: "/gmb-hub", icon: Star }] : []),
                  ...platforms.map((p) => ({
                    key: p.key,
                    label: p.label,
                    href: p.href,
                    icon: PLATFORM_ICONS[p.key] ?? Sparkles
                  }))
                ];
                return orderItems(allItems.map((i) => i.key), platformOrder).map((key, idx, arr) => {
                  const p = allItems.find((x) => x.key === key);
                  if (!p) return null;
                  const Icon = p.icon;
                  const active = key === "gmb_hub" ? gmbActive : pathname.startsWith(p.href);
                  const cost = usage.platforms[p.key] ?? 0;
                  return (
                    <div key={p.key} className="group flex items-center gap-1">
                      <Link
                        onClick={onNavigate}
                        href={p.href}
                        className={clsx(
                          "flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors min-w-0",
                          active
                            ? "bg-brand-600/25 text-white font-medium"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        )}
                      >
                        <span
                          className="h-5 w-5 rounded-md shrink-0 grid place-items-center text-white shadow-sm"
                          style={{ background: PLATFORM_GRAD[p.key] ?? PLATFORM_GRAD_DEFAULT }}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                        <span className="truncate flex-1">{p.label}</span>
                        {key !== "gmb_hub" && <UsageBar micros={cost} max={usage.maxMicros} />}
                      </Link>
                      <div className="hidden group-hover:flex flex-col -mx-0.5">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); movePlatform(p.key, -1); }}
                          disabled={idx === 0}
                          className="h-3 w-4 grid place-items-center rounded text-slate-500 hover:text-white disabled:opacity-30"
                          title="Subir"
                        >
                          <ArrowUp className="h-2.5 w-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); movePlatform(p.key, 1); }}
                          disabled={idx === arr.length - 1}
                          className="h-3 w-4 grid place-items-center rounded text-slate-500 hover:text-white disabled:opacity-30"
                          title="Bajar"
                        >
                          <ArrowDown className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
              {platforms.length === 0 && !showGmb && me?.role === "ADMIN" && (
                <Link onClick={onNavigate}
                  href="/admin/plataformas"
                  className="block px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                >
                  Activa una plataforma →
                </Link>
              )}
            </div>
          </div>
          );
        })()}

        {me?.role === "ADMIN" && !isHidden("section:otros-proyectos") && (
          <div className="pt-4 mt-2 border-t border-slate-800">
            <span className="px-3 mb-1 text-[10px] uppercase tracking-wide text-slate-400 font-semibold flex items-center gap-1.5">
              <MapPin className="h-3 w-3" />
              Otros Proyectos
            </span>
            {/* Bubui + acceso directo a todas sus áreas */}
            <Link
              onClick={onNavigate}
              href="/bubui"
              className={clsx(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors",
                pathname === "/bubui"
                  ? "bg-brand-600/25 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <span
                className="h-4 w-4 rounded-[5px] shrink-0 grid place-items-center text-[9px] font-black text-white"
                style={{ background: "linear-gradient(135deg,#F86FB0,#D1186A)" }}
              >
                b
              </span>
              <span className="font-semibold">Bubui</span>
            </Link>
            <div className="ml-5 mt-0.5 border-l border-slate-800 pl-2 space-y-0.5">
              {BUBUI_LINKS.map((l) => {
                const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    onClick={onNavigate}
                    href={l.href}
                    className={clsx(
                      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors",
                      active
                        ? "bg-brand-600/25 text-white font-medium"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white"
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-pink-500 shrink-0" />
                    <span className="truncate">{l.label}</span>
                  </Link>
                );
              })}
            </div>

            {/* Buscador Inmobiliario (activos de banca) */}
            <Link
              onClick={onNavigate}
              href="/admin/buscador-inmobiliario"
              className={clsx(
                "mt-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors",
                pathname.startsWith("/admin/buscador-inmobiliario")
                  ? "bg-brand-600/25 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <span
                className="h-4 w-4 rounded-[5px] shrink-0 grid place-items-center text-white"
                style={{ background: "linear-gradient(135deg,#2E7D5B,#1B4D3E)" }}
              >
                <Building2 className="h-2.5 w-2.5" />
              </span>
              <span className="font-semibold">Buscador inmobiliario</span>
            </Link>
          </div>
        )}
      </nav>

      <div className="border-t border-slate-800 p-3">
        {(!me || me.role === "ADMIN") && (
          <Link onClick={onNavigate}
            href="/admin/sonia-autonomia"
            className={clsx(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              pathname.startsWith("/admin/sonia-autonomia")
                ? "bg-brand-600/25 text-white font-medium"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            )}
          >
            <Activity className="h-4 w-4" />
            Autonomía de Sonia
          </Link>
        )}
        <Link onClick={onNavigate}
          href="/admin"
          className="mt-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <Settings className="h-4 w-4" />
          Administración
        </Link>
        <Link onClick={onNavigate}
          href="/perfil"
          className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800"
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
            <div className="text-sm font-medium truncate text-white">{me?.name ?? me?.email ?? "Cargando…"}</div>
            <div className="text-xs text-slate-400">
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
    <div className="px-3 py-2 border-t border-slate-800 bg-slate-950 text-[10px] text-slate-400 shrink-0">
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
        className="font-mono hover:text-white truncate w-full text-left disabled:opacity-50 leading-tight"
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
