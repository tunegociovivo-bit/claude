/**
 * Manifest PWA. Dinámico para usar el nombre del workspace si está
 * disponible. Si no hay BD, devuelve un default razonable.
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
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#5B6CFF",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };

  return new NextResponse(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300"
    }
  });
}
