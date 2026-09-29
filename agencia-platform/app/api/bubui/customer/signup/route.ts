import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Retired email-only login. Account creation happens only after verified OTP. */
export async function POST(_req: Request) {
  return NextResponse.json({ error: { code: "verification_required", message: "Actualiza Bubui e inicia sesión con el código enviado a tu teléfono." } }, { status: 410 });
}
