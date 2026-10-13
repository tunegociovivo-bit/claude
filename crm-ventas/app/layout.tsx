import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Ventas | Negocio Vivo",
  description: "CRM con recepcionista IA: llamadas, WhatsApp, citas y calendario",
  appleWebApp: { capable: true, title: "CRM", statusBarStyle: "default" },
};

// Móvil: ocupa también la zona de la muesca (safe-area) y el teclado
// redimensiona la página en Android para que la caja de escribir no quede tapada.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
