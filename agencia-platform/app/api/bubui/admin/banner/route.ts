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
  active: z.boolean().optional().default(false),
  kind: z.enum(["link", "business", "promo"]).optional().default("link"),
  link: z.string().max(2000).optional().default(""),
  businessId: z.string().max(100).optional().default(""),
  promoTitle: z.string().max(120).optional().default(""),
  promoCategory: z.string().max(80).optional().default(""),
  promoDescription: z.string().max(1000).optional().default(""),
  promoDiscountPct: z.number().int().min(0).max(100).nullable().optional().default(null),
  promoCtaLabel: z.string().max(60).optional().default(""),
  promoCtaLink: z.string().max(2000).optional().default("")
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
