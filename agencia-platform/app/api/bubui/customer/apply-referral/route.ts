/**
 * POST /api/bubui/customer/apply-referral  → { customerId, code }
 *
 * Reintento de vinculación de referido DESPUÉS del alta. El camino normal es
 * verify-otp con `ref`, pero esa llamada traga errores (`.catch(() => {})`)
 * y la captura del Install Referrer puede llegar tarde en algunos móviles —
 * en ambos casos el código se perdía para siempre y el amigo se quedaba sin
 * cupón de bienvenida (y el referidor sin progreso en su reto).
 *
 * applyReferral es idempotente (no duplica premios si ya estaba vinculado),
 * así que la app puede llamar aquí con tranquilidad hasta que confirme.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { applyReferral } from "@/lib/bubui/referral";
import { customerAuthOk } from "@/lib/bubui/customer-auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  customerId: z.string().min(1),
  code: z.string().trim().min(4).max(12)
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const d = parsed.data;
  if (!(await customerAuthOk(req, d.customerId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const result = await applyReferral(d.customerId, d.code);
  console.log(`[apply-referral] customer=${d.customerId} code=${d.code} →`, JSON.stringify(result));
  return NextResponse.json({ ok: true, ...result });
}
