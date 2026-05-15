import type { Metadata } from "next";
import "./globals.css";
import AppChrome from "@/components/AppChrome";

export const metadata: Metadata = {
  title: "Agencia Hub — Plataforma interna",
  description: "Prototipo de plataforma interna para agencia de marketing"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
