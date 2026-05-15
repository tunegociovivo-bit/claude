import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppChrome from "@/components/AppChrome";

export const metadata: Metadata = {
  title: "Hub — Plataforma interna",
  description: "Plataforma interna multifunción"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#5B6CFF"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="overscroll-none">
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
