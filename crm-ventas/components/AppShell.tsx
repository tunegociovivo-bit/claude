"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  KanbanSquare,
  CalendarDays,
  MessageCircle,
  Phone,
  Settings,
  LogOut,
} from "lucide-react";

const NAV = [
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/calendario", label: "Calendario", icon: CalendarDays },
  { href: "/conversaciones", label: "WhatsApp", icon: MessageCircle },
  { href: "/llamadas", label: "Llamadas", icon: Phone },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/settings/logo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLogo(d?.logoDataUrl ?? null))
      .catch(() => undefined);
  }, []);

  return (
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
            <div className="text-xs text-slate-500">PAULA</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                pathname.startsWith(href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <Icon size={17} />
              {label}
            </Link>
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
  );
}
