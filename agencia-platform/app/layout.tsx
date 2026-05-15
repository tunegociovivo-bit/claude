import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppChrome from "@/components/AppChrome";
import PwaRegister from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "Hub — Plataforma interna",
  description: "Plataforma interna multifunción",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Hub",
    statusBarStyle: "default"
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }]
  }
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
        <PwaRegister />
      </body>
    </html>
  );
}
