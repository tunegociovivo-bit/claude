/**
 * POST /api/bipi/customer/verify-otp
 *   { phone, code, name?, email?, firstBusinessId? }
 *
 * Comprueba el código SMS (Twilio Verify). Si es correcto, crea o
 * recupera el cliente (identidad = teléfono verificado) y devuelve la
 * sesión. Este es el alta REAL: sin código válido no se crea cuenta.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { toE164, checkVerification } from "@/lib/bipi/twilio";

export const dynamic = "force-dynamic";

const schema = z.object({
  phone: z.string().min(6).max(40),
  code: z.string().min(4).max(10),
  name: z.string().max(80).optional(),
  email: z.string().email().optional().or(z.literal("")),
  firstBusinessId: z.string().optional()
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: "Datos inválidos" } }, { status: 400 });
  }
  const d = parsed.data;
  const phone = toE164(d.phone);
  if (!phone) {
    return NextResponse.json({ error: { code: "bad_phone", message: "Número de teléfono no válido" } }, { status: 400 });
  }

  const check = await checkVerification(phone, d.code);
  if (!check.configured) {
    return NextResponse.json(
      { error: { code: "sms_not_configured", message: "La verificación por SMS aún no está activada en el servidor." } },
      { status: 503 }
    );
  }
  if (!check.approved) {
    return NextResponse.json(
      { error: { code: "bad_code", message: "Código incorrecto o caducado. Pide uno nuevo." } },
      { status: 401 }
    );
  }

  const email = d.email ? d.email : undefined;

  // ¿Ya existe por teléfono? -> login. Si no, crear.
  const existing = await prisma.bipiCustomer.findUnique({ where: { phone } });
  if (existing) {
    const updated = await prisma.bipiCustomer.update({
      where: { id: existing.id },
      data: {
        phoneVerified: true,
        name: d.name ?? existing.name,
        email: email ?? existing.email ?? undefined
      }
    });
    return NextResponse.json({
      ok: true,
      reused: true,
      customerId: updated.id,
      name: updated.name,
      totalSaved: updated.totalSaved,
      totalPurchases: updated.totalPurchases
    });
  }

  const customer = await prisma.bipiCustomer.create({
    data: {
      phone,
      phoneVerified: true,
      name: d.name,
      email,
      firstBusinessId: d.firstBusinessId ?? null
    }
  });
  return NextResponse.json(
    {
      ok: true,
      reused: false,
      customerId: customer.id,
      name: customer.name,
      totalSaved: 0,
      totalPurchases: 0
    },
    { status: 201 }
  );
}
