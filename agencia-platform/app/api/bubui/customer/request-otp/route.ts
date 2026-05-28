/**
 * POST /api/bubui/customer/request-otp  { phone }
 *
 * Inicia la verificación por SMS (Twilio Verify). Devuelve el teléfono
 * normalizado en E.164 para que el cliente lo reutilice en verify-otp.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { toE164, startVerification } from "@/lib/bubui/twilio";

export const dynamic = "force-dynamic";

const schema = z.object({ phone: z.string().min(6).max(40) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: "Teléfono inválido" } }, { status: 400 });
  }
  const phone = toE164(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: { code: "bad_phone", message: "Número de teléfono no válido" } }, { status: 400 });
  }

  const res = await startVerification(phone);
  if (!res.configured) {
    return NextResponse.json(
      { error: { code: "sms_not_configured", message: "La verificación por SMS aún no está activada en el servidor." } },
      { status: 503 }
    );
  }
  if (!res.ok) {
    return NextResponse.json({ error: { code: "sms_failed", message: res.error } }, { status: 502 });
  }
  return NextResponse.json({ ok: true, phone });
}
