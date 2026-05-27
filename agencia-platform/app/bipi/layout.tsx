import type { Metadata, Viewport } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Bipi — Descuentos cruzados entre negocios cerca de ti",
  description:
    "Escanea, paga, descubre. Cada compra en un negocio Bipi te abre descuentos en otros negocios cerca de ti. Piloto en Benalmádena.",
  manifest: "/bipi/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bipi"
  },
  icons: {
    icon: [
      { url: "/bipi/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/bipi/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/bipi/icon-192.png", sizes: "192x192" }]
  }
};

export const viewport: Viewport = {
  themeColor: "#C8612C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function BipiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-amber-50">
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/bipi" className="font-bold text-xl tracking-tight">
            <span className="text-amber-600">bi</span>pi
          </a>
          <nav className="text-sm flex items-center gap-4">
            <a href="/bipi/registro" className="text-slate-700 hover:text-amber-700">
              Soy un negocio
            </a>
            <a href="/bipi/app" className="text-slate-700 hover:text-amber-700">
              Soy cliente
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t mt-16 py-6 text-center text-xs text-slate-500">
        Bipi · Piloto en Benalmádena · Una app de Negocio Vivo
      </footer>
    </div>
  );
}
