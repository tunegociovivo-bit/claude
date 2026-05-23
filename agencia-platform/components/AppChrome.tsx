"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import AIAssistant from "@/components/ai/AIAssistant";
import CommandPalette from "@/components/CommandPalette";
import MetaCooldownVoiceNotifier from "@/components/MetaCooldownVoiceNotifier";
import FlashTaskVoiceNotifier from "@/components/FlashTaskVoiceNotifier";

const NO_CHROME_PREFIXES = ["/login", "/r/", "/v/", "/p/"];

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const minimal = NO_CHROME_PREFIXES.some(
    (p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p)
  );

  // Estado del sidebar en móvil: por defecto cerrado.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cierra al navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Cierra con Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (minimal) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Overlay móvil */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: oculto en móvil por defecto, drawer cuando mobileOpen.
          En md+ siempre visible. */}
      <div
        className={
          "fixed inset-y-0 left-0 z-50 transform transition-transform md:relative md:transform-none md:z-auto " +
          (mobileOpen ? "translate-x-0" : "-translate-x-full") +
          " md:translate-x-0"
        }
      >
        <Suspense fallback={<aside className="w-72 md:w-64 shrink-0 border-r border-slate-800 bg-slate-900 h-screen" />}>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </Suspense>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar onToggleMobileMenu={() => setMobileOpen((v) => !v)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          {children}
        </main>
      </div>
      <AIAssistant />
      <CommandPalette />
      <MetaCooldownVoiceNotifier />
      <FlashTaskVoiceNotifier />
    </div>
  );
}
