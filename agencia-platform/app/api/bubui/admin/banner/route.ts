/**
 * GET/PUT /api/bubui/admin/banner  (cabecera x-admin-token)
 * Lee y actualiza el banner del Home gestionable desde el panel.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import { getHomeBanner, setHomeBanner } from "@/lib/bubui/banner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  return NextResponse.json(await getHomeBanner());
}

const schema = z.object({
  imageUrl: z.string().max(2000).optional().default(""),
  link: z.string().max(2000).optional().default(""),
  active: z.boolean().optional().default(false)
});

export async function PUT(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  const saved = await setHomeBanner(parsed.data);
  return NextResponse.json(saved);
}
