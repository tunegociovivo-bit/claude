/**
 * POST /api/v1/gmb/review-link/brand { website } — saca de la web del negocio su email de
 * contacto, logo y color principal para autorrellenar la página de valoración. Best-effort.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { extractBrand } from "@/lib/gmb/brand-extract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "*" }, async (req) => {
  const body = await req.json().catch(() => ({}));
  const website = String(body?.website ?? "").trim().slice(0, 500);
  if (!website) return NextResponse.json({ ok: true, brand: null });
  const brand = await Promise.race([
    extractBrand(website),
    new Promise<null>((r) => setTimeout(() => r(null), 45_000))
  ]).catch(() => null);
  return NextResponse.json({ ok: true, brand });
});
