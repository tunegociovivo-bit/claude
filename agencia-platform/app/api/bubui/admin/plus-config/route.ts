/**
 * Admin · Configuración de Bubui Plus.
 *   GET → { earlyAccessHours }
 *   PUT { earlyAccessHours } → guarda la ventana de acceso anticipado.
 *
 * Auth: sesión admin (NextAuth, role ADMIN).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import { getPlusEarlyAccessHours, setPlusEarlyAccessHours } from "@/lib/bubui/plus";

export const dynamic = "force-dynamic";

const schema = z.object({ earlyAccessHours: z.number().int().min(0).max(720) });

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  return NextResponse.json({ earlyAccessHours: await getPlusEarlyAccessHours() });
}

export async function PUT(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  return NextResponse.json({ earlyAccessHours: await setPlusEarlyAccessHours(parsed.data.earlyAccessHours) });
}
