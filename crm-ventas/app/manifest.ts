import type { MetadataRoute } from "next";

// Instalable en la pantalla de inicio del móvil (se abre como una app, sin barra del navegador).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRM Ventas",
    short_name: "CRM",
    description: "Pipeline, WhatsApp unificado y citas",
    start_url: "/pipeline",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#ffffff",
    lang: "es",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
