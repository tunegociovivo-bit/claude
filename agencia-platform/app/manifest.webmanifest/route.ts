/**
 * Manifest PWA. Dinámico para usar el nombre del workspace si está
 * disponible. Si no hay BD, devuelve un default razonable.
 *
 * Esta es la app instalable en Android (Chrome → menú → "Instalar
 * app") y en iOS (Safari → Compartir → "Añadir a pantalla de
 * inicio"). Una vez instalada se abre sin barra de URL, en su
 * propia tarea del sistema, con icono propio y soporta notif. push.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  let name = "Agencia Hub";
  let shortName = "Hub";
  try {
    const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
    if (ws?.name) {
      name = ws.name;
      shortName = ws.name.split(/\s+/)[0].slice(0, 12) || "Hub";
    }
  } catch {}

  const manifest = {
    name,
    short_name: shortName,
    description: "Plataforma interna de gestión de agencia",
    start_url: "/",
    scope: "/",
    // standalone = se abre sin URL bar, como app nativa.
    display: "standalone",
    // fullscreen quitaría también la status bar; con standalone
    // mantenemos la batería/hora visibles, más natural.
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#5B6CFF",
    lang: "es",
    dir: "ltr",
    categories: ["productivity", "business"],
    // Iconos. Importante el `maskable` separado: Android lo recorta
    // en círculo/squircle según el tema del launcher; si usamos el
    // mismo icono que el "any", el corte se come parte del logo.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    // Atajos del launcher de Android: al mantener pulsado el icono
    // de la app salen estas acciones. Las URLs son rutas internas
    // de la PWA. Cada uno puede tener su propio icono — usamos el
    // mismo por ahora para mantenerlo simple.
    shortcuts: [
      {
        name: "Tareas",
        short_name: "Tareas",
        description: "Ver y gestionar tareas",
        url: "/tareas",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Mi día",
        short_name: "Mi día",
        description: "Tu vista del día",
        url: "/mi-dia",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Calendario",
        short_name: "Calendario",
        description: "Calendario editorial y de equipo",
        url: "/calendario",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }]
      }
    ]
  };

  return new NextResponse(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300"
    }
  });
}
