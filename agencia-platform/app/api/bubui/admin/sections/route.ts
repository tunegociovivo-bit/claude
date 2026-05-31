/**
 * GET  /api/bubui/admin/sections  → estado de las secciones gated (Descubre/Mapa)
 * PATCH /api/bubui/admin/sections  → { discover?, mapa? } con "auto"|"on"|"off"
 * (cabecera x-admin-token)
 *
 * Permite al admin forzar la visibilidad de Descubre y Mapa sin esperar a los
 * 10 comercios activos.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import { getSectionVisibility, setOverrides, MIN_BUSINESSES } from "@/lib/bubui/sections";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const { businesses, discover, mapa, modes } = await getSectionVisibility();
  return NextResponse.json({ businesses, minBusinesses: MIN_BUSINESSES, visible: { discover, mapa }, modes });
}

const mode = z.enum(["auto", "on", "off"]);
const schema = z.object({ discover: mode.optional(), mapa: mode.optional() });

export async function PATCH(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  await setOverrides(parsed.data);
  const { businesses, discover, mapa, modes } = await getSectionVisibility();
  return NextResponse.json({ businesses, minBusinesses: MIN_BUSINESSES, visible: { discover, mapa }, modes });
}
