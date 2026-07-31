/**
 * POST /api/bubui/customer/apply-ref   { customerId, ref }
 *
 * Aplica un código de invitación a un cliente YA REGISTRADO (que abrió un
 * enlace /r/<code> estando ya logueado y por tanto no pasó por el alta, donde
 * normalmente se aplica). Idempotente: applyReferral no hace nada si el cliente
 * ya tenía referidor. Así el amigo recibe su cupón de bienvenida aunque ya
 * estuviera dado de alta en Bubui.
 *
 * Auth: token de sesión del propio cliente (Bearer <customerId>:<token>).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { applyReferral } from "@/lib/bubui/referral";

export const dynamic = "force-dynamic";

const schema = z.object({ customerId: z.string().min(1), ref: z.string().trim().min(1).max(40) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: "Datos inválidos" } }, { status: 400 });
  }
  const { customerId, ref } = parsed.data;
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  await applyReferral(customerId, ref).catch(() => {});
  return NextResponse.json({ ok: true });
}
