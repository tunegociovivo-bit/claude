/**
 * GET   /api/bubui/admin/ai-banner  → { policy: "all" | "paid" }
 * PATCH /api/bubui/admin/ai-banner  → body { policy: "all" | "paid" }
 * (cabecera x-admin-token)
 *
 * Permite al admin limitar el Banner IA a los planes de pago (o abrirlo a
 * todos) sin tocar código ni redeplegar.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import { getAiBannerPolicy, setAiBannerPolicy } from "@/lib/bubui/ai-banner-settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  return NextResponse.json({ policy: await getAiBannerPolicy() });
}

const schema = z.object({ policy: z.enum(["all", "paid"]) });

export async function PATCH(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  return NextResponse.json({ policy: await setAiBannerPolicy(parsed.data.policy) });
}
