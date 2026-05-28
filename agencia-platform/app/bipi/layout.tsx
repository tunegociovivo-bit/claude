import type { Metadata, Viewport } from "next";
import "../globals.css";
import "./bipi.css";
import InstallPrompt from "./InstallPrompt";

export const metadata: Metadata = {
  title: "Bipi — Descuentos cruzados entre negocios cerca de ti",
  description:
    "Escanea, paga, descubre. Cada compra en un negocio Bipi te abre descuentos en otros cerca de ti. Piloto en Benalmádena.",
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
  themeColor: "#EC4899",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function BipiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bipi-bg text-black">
      <header className="border-b border-black/5 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/bipi" className="inline-flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bipi/logo.png" alt="bipi" style={{ height: 28, width: "auto" }} />
          </a>
          <nav className="text-sm flex items-center gap-3">
            <a href="/bipi/registro" className="text-black/70 hover:text-pink-600 font-semibold">
              Negocios
            </a>
            <a
              href="/bipi/app"
              className="text-white bg-black hover:bg-pink-600 transition rounded-full px-4 py-1.5 font-semibold"
            >
              Abrir app
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="mt-20 py-8 text-center text-xs text-black/40 border-t border-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bipi/logo.png" alt="bipi" className="inline-block align-middle" style={{ height: 20, width: "auto" }} />
        <span className="mx-2">·</span>
        Ahorra. Disfruta. Apoya local. · Piloto en Benalmádena · Una app de Negocio Vivo
      </footer>
      <InstallPrompt />
    </div>
  );
}
