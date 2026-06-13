/**
 * GET   /api/bubui/anunciate-button
 *   Público (lo consulta el panel del comercio): ¿está activo el botón
 *   flotante "Anúnciate"? → { enabled: boolean }
 *
 * PATCH /api/bubui/anunciate-button
 *   Solo admin: enciende/apaga el botón. body { enabled: boolean }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import { getAnunciateButtonEnabled, setAnunciateButtonEnabled } from "@/lib/bubui/anunciate-button";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ enabled: await getAnunciateButtonEnabled() });
}

const schema = z.object({ enabled: z.boolean() });

export async function PATCH(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  return NextResponse.json({ enabled: await setAnunciateButtonEnabled(parsed.data.enabled) });
}
