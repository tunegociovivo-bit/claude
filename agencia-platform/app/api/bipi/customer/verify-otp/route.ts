/**
 * POST /api/bipi/customer/verify-otp
 *   { phone, code, name, email, birthDate, gender, firstBusinessId? }
 *
 * Comprueba el código SMS (Twilio Verify). Si es correcto, crea o
 * recupera el cliente. Identidad principal = teléfono verificado, pero
 * si el email ya existía (de altas previas) se FUSIONA en esa cuenta en
 * vez de fallar por email duplicado.
 *
 * email, birthDate y gender son OBLIGATORIOS.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { toE164, checkVerification } from "@/lib/bipi/twilio";

export const dynamic = "force-dynamic";

const schema = z.object({
  phone: z.string().min(6).max(40),
  code: z.string().min(4).max(10),
  name: z.string().min(1).max(80),
  email: z.string().email(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  gender: z.enum(["female", "male", "other", "prefer_not"]),
  firstBusinessId: z.string().optional()
});

function sessionFrom(c: { id: string; name: string | null; totalSaved: number; totalPurchases: number }, reused: boolean, status = 200) {
  return NextResponse.json(
    { ok: true, reused, customerId: c.id, name: c.name, totalSaved: c.totalSaved, totalPurchases: c.totalPurchases },
    { status }
  );
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.issues[0]?.message ?? "Datos inválidos" } }, { status: 400 });
  }
  const d = parsed.data;
  const phone = toE164(d.phone);
  if (!phone) {
    return NextResponse.json({ error: { code: "bad_phone", message: "Número de teléfono no válido" } }, { status: 400 });
  }

  const check = await checkVerification(phone, d.code);
  if (!check.configured) {
    return NextResponse.json({ error: { code: "sms_not_configured", message: "La verificación por SMS aún no está activada en el servidor." } }, { status: 503 });
  }
  if (!check.approved) {
    return NextResponse.json({ error: { code: "bad_code", message: "Código incorrecto o caducado. Pide uno nuevo." } }, { status: 401 });
  }

  const profile = { name: d.name, email: d.email, birthDate: d.birthDate, gender: d.gender };

  // 1) ¿Existe ya por teléfono? -> login/actualización.
  const byPhone = await prisma.bipiCustomer.findUnique({ where: { phone } });
  if (byPhone) {
    try {
      const updated = await prisma.bipiCustomer.update({ where: { id: byPhone.id }, data: { phoneVerified: true, ...profile } });
      return sessionFrom(updated, true);
    } catch (e: any) {
      if (e?.code === "P2002") {
        return NextResponse.json({ error: { code: "email_taken", message: "Ese email ya está en uso por otra cuenta." } }, { status: 409 });
      }
      throw e;
    }
  }

  // 2) ¿Existe por email (alta previa sin teléfono)? -> fusionar: añadir teléfono.
  const byEmail = await prisma.bipiCustomer.findUnique({ where: { email: d.email } });
  if (byEmail) {
    if (byEmail.phone && byEmail.phone !== phone) {
      return NextResponse.json({ error: { code: "email_other_phone", message: "Ese email ya tiene cuenta con otro teléfono. Usa ese número o cambia de email." } }, { status: 409 });
    }
    const merged = await prisma.bipiCustomer.update({ where: { id: byEmail.id }, data: { phone, phoneVerified: true, ...profile } });
    return sessionFrom(merged, true);
  }

  // 3) Crear nuevo.
  try {
    const created = await prisma.bipiCustomer.create({
      data: { phone, phoneVerified: true, ...profile, firstBusinessId: d.firstBusinessId ?? null }
    });
    return sessionFrom(created, false, 201);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: { code: "email_taken", message: "Ese email ya está en uso. Inténtalo con otro." } }, { status: 409 });
    }
    throw e;
  }
}
