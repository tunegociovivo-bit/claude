"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { AgentNameProvider } from "@/components/AgentNameContext";
import {
  KanbanSquare,
  CalendarDays,
  MessageCircle,
  Phone,
  Settings,
  LogOut,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

const NAV = [
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/calendario", label: "Calendario", icon: CalendarDays },
  { href: "/conversaciones", label: "WhatsApp", icon: MessageCircle },
  { href: "/llamadas", label: "Llamadas", icon: Phone },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

const NAV_ORDER_KEY = "crm-ventas:navigation-order";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [logo, setLogo] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("Paula");
  const [nav, setNav] = useState(NAV);

  useEffect(() => {
    fetch("/api/v1/settings/logo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setLogo(d?.logoDataUrl ?? null);
        setAgentName(d?.agentName || "Paula");
      })
      .catch(() => undefined);

    try {
      const saved = JSON.parse(localStorage.getItem(NAV_ORDER_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        const ordered = saved
          .map((href) => NAV.find((item) => item.href === href))
          .filter((item): item is (typeof NAV)[number] => Boolean(item));
        const missing = NAV.filter((item) => !ordered.some((savedItem) => savedItem.href === item.href));
        setNav([...ordered, ...missing]);
      }
    } catch {
      // Conserva el orden predeterminado si el dato local no es válido.
    }
  }, []);

  useEffect(() => {
    const reloadLogo = () => {
      fetch("/api/v1/settings/logo", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => setLogo(data?.logoDataUrl ?? null))
        .catch(() => undefined);
    };
    window.addEventListener("business-logo-changed", reloadLogo);
    return () => window.removeEventListener("business-logo-changed", reloadLogo);
  }, []);

  useEffect(() => {
    const updateAgentName = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (name) setAgentName(name);
    };
    window.addEventListener("agent-name-changed", updateAgentName);
    return () => window.removeEventListener("agent-name-changed", updateAgentName);
  }, []);

  function moveNav(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= nav.length) return;
    const next = [...nav];
    [next[index], next[target]] = [next[target], next[index]];
    setNav(next);
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next.map((item) => item.href)));
  }

  return (
    <AgentNameProvider name={agentName}>
    <div className="min-h-screen md:flex">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="Logo del negocio" className="h-9 w-9 rounded-xl object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 font-bold text-white">P</div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">CRM Ventas</div>
          <div className="truncate text-xs text-slate-500">{agentName.toUpperCase()}</div>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar sesión">
          <LogOut size={18} />
        </button>
      </header>
      <aside className="hidden w-16 shrink-0 flex-col border-r border-slate-200 bg-white md:flex lg:w-56">
        <div className="flex items-center justify-center gap-2 px-2 py-5 lg:justify-start lg:px-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt="Logo del negocio"
              className="h-9 w-9 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 font-bold text-white">
              P
            </div>
          )}
          <div className="hidden min-w-0 lg:block">
            <div className="text-sm font-semibold leading-tight">CRM Ventas</div>
            <div className="text-xs text-slate-500">{agentName.toUpperCase()}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {nav.map(({ href, label, icon: Icon }, index) => (
            <div key={href} className="group flex items-center gap-1">
              <Link
                href={href}
                className={clsx(
                  "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm font-medium lg:justify-start",
                  pathname.startsWith(href)
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Icon size={17} />
                <span className="hidden lg:inline">{label}</span>
              </Link>
              <div className="hidden w-5 flex-col opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 lg:flex">
                <button type="button" onClick={() => moveNav(index, -1)} disabled={index === 0} className="text-slate-400 hover:text-brand-600 disabled:opacity-20" title={`Subir ${label}`}>
                  <ChevronUp size={13} />
                </button>
                <button type="button" onClick={() => moveNav(index, 1)} disabled={index === nav.length - 1} className="text-slate-400 hover:text-brand-600 disabled:opacity-20" title={`Bajar ${label}`}>
                  <ChevronDown size={13} />
                </button>
              </div>
            </div>
          ))}
        </nav>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="m-2 flex min-h-11 items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 lg:justify-start"
        >
          <LogOut size={17} />
          <span className="hidden lg:inline">Salir</span>
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-3 pb-24 sm:p-4 sm:pb-24 md:p-5 md:pb-5 lg:p-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white/95 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={clsx("flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium", pathname.startsWith(href) ? "bg-brand-50 text-brand-700" : "text-slate-500")}>
            <Icon size={19} />
            <span className="w-full truncate text-center">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
    </AgentNameProvider>
  );
}
