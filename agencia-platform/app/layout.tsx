import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import AIAssistant from "@/components/ai/AIAssistant";

export const metadata: Metadata = {
  title: "Agencia Hub — Plataforma interna",
  description: "Prototipo de plataforma interna para agencia de marketing"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="flex h-screen overflow-hidden">
          <Suspense fallback={<aside className="w-64 shrink-0 border-r bg-white" />}>
            <Sidebar />
          </Suspense>
          <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar />
            <main className="flex-1 overflow-y-auto scrollbar-thin px-8 py-6">{children}</main>
          </div>
        </div>
        <AIAssistant />
      </body>
    </html>
  );
}
