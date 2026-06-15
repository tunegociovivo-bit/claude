/**
 * GET   /api/bubui/admin/ai-banner  → { policy: "all" | "paid", freeCount: number }
 * PATCH /api/bubui/admin/ai-banner  → body { policy?, freeCount? }
 * (sesión admin)
 *
 * Permite al admin limitar el Banner IA a los planes de pago (o abrirlo a
 * todos) y elegir cuántos banners gratis tiene cada negocio antes de pagar
 * 1€/edición — sin tocar código ni redeplegar.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import {
  getAiBannerPolicy,
  setAiBannerPolicy,
  getAiBannerFreeCount,
  setAiBannerFreeCount
} from "@/lib/bubui/ai-banner-settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const [policy, freeCount] = await Promise.all([getAiBannerPolicy(), getAiBannerFreeCount()]);
  return NextResponse.json({ policy, freeCount });
}

const schema = z.object({
  policy: z.enum(["all", "paid"]).optional(),
  freeCount: z.number().int().min(0).max(100).optional()
});

export async function PATCH(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  if (parsed.data.policy !== undefined) await setAiBannerPolicy(parsed.data.policy);
  if (parsed.data.freeCount !== undefined) await setAiBannerFreeCount(parsed.data.freeCount);
  const [policy, freeCount] = await Promise.all([getAiBannerPolicy(), getAiBannerFreeCount()]);
  return NextResponse.json({ policy, freeCount });
}
