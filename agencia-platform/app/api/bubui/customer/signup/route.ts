/**
 * POST /api/bubui/customer/signup
 *
 * Alta de cliente Bubui. Versión v1: sin contraseña (auth solo por
 * customerId guardado en localStorage del dispositivo). Cuando saltemos
 * a apps nativas, añadimos OTP por SMS o email.
 *
 * Si recibe firstBusinessId (el cliente llegó vía QR de un negocio),
 * lo persistimos para tracking del onboarding.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  name: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  firstBusinessId: z.string().optional()
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const d = parsed.data;

  // Si el email ya existe, devolvemos su customerId (login-by-email v1).
  const existing = await prisma.bubuiCustomer.findUnique({ where: { email: d.email } });
  if (existing) {
    return NextResponse.json({
      ok: true,
      reused: true,
      customerId: existing.id,
      name: existing.name,
      totalSaved: existing.totalSaved,
      totalPurchases: existing.totalPurchases
    });
  }

  const customer = await prisma.bubuiCustomer.create({
    data: {
      email: d.email,
      name: d.name,
      phone: d.phone,
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
