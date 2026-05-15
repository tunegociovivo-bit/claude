/**
 * Endpoint público (sin auth) que devuelve nombre y logo del workspace
 * principal para que la pantalla de login pueda mostrarlos.
 *
 * Multi-workspace: hay un único workspace por instancia de Hub (decisión
 * actual), así que devolvemos el primero. Si en el futuro hay varios, se
 * puede usar el host del request para elegir.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const ws = await prisma.workspace.findFirst({
    select: { name: true, logo: true },
    orderBy: { createdAt: "asc" }
  });
  return NextResponse.json(
    ws ?? { name: "Hub", logo: null },
    {
      headers: { "Cache-Control": "public, max-age=60" }
    }
  );
}
