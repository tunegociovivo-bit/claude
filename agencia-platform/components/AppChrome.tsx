"use client";

import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import AIAssistant from "@/components/ai/AIAssistant";

/**
 * Rutas que NO deben llevar la chrome (sidebar / topbar / asistente IA):
 * - /login: pantalla de login antes de tener sesión
 * - /r/*: páginas públicas de widget de reseñas, pensadas para iframe
 */
const NO_CHROME_PREFIXES = ["/login", "/r/"];

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const minimal = NO_CHROME_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));

  if (minimal) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Suspense fallback={<aside className="w-64 shrink-0 border-r bg-white" />}>
        <Sidebar />
      </Suspense>
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto scrollbar-thin px-8 py-6">{children}</main>
      </div>
      <AIAssistant />
    </div>
  );
}
