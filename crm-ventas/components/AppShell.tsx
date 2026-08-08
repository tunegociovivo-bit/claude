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
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-4 py-5">
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
          <div>
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
                  "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                  pathname.startsWith(href)
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Icon size={17} />
                {label}
              </Link>
              <div className="flex w-5 flex-col opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
          className="m-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
        >
          <LogOut size={17} />
          Salir
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
    </AgentNameProvider>
  );
}
