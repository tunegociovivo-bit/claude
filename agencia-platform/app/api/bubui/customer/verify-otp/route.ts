/**
 * POST /api/bubui/customer/verify-otp
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
import { toE164, checkVerification } from "@/lib/bubui/twilio";
import { ensureReferralCode, applyReferral } from "@/lib/bubui/referral";
import { issueCustomerToken } from "@/lib/bubui/customer-auth";
import { rateLimit } from "@/lib/api/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({
  phone: z.string().min(6).max(40),
  code: z.string().min(4).max(10),
  name: z.string().min(1).max(80),
  email: z.string().email(),
  // Datos opcionales (Apple 5.1.1(v): no pueden ser obligatorios). Si llegan
  // vacíos los tratamos como ausentes.
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional().or(z.literal("")),
  gender: z.enum(["female", "male", "other", "prefer_not"]).optional().or(z.literal("")),
  postalCode: z.string().regex(/^\d{5}$/, "Código postal inválido").optional().or(z.literal("")),
  firstBusinessId: z.string().optional(),
  ref: z.string().max(12).optional()
});

async function sessionFrom(c: { id: string; name: string | null; totalSaved: number; totalPurchases: number }, reused: boolean, status = 200) {
  // Emite/renueva el token de sesión y lo devuelve para que la app lo guarde.
  const token = await issueCustomerToken(c.id);
  return NextResponse.json(
    { ok: true, reused, customerId: c.id, name: c.name, totalSaved: c.totalSaved, totalPurchases: c.totalPurchases, token },
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

  // Anti fuerza bruta: máx 6 intentos de código por minuto y teléfono.
  if (!rateLimit(`bubui-otp-check:${phone}`, 6).ok) {
    return NextResponse.json({ error: { code: "rate_limit", message: "Demasiados intentos. Espera un minuto." } }, { status: 429 });
  }

  const check = await checkVerification(phone, d.code);
  if (!check.configured) {
    return NextResponse.json({ error: { code: "sms_not_configured", message: "La verificación por SMS aún no está activada en el servidor." } }, { status: 503 });
  }
  if (!check.approved) {
    return NextResponse.json({ error: { code: "bad_code", message: "Código incorrecto o caducado. Pide uno nuevo." } }, { status: 401 });
  }

  // Normaliza opcionales: "" → undefined (no se guarda ni pisa lo existente).
  const profile = {
    name: d.name,
    email: d.email,
    birthDate: d.birthDate || undefined,
    gender: (d.gender || undefined) as "female" | "male" | "other" | "prefer_not" | undefined,
    postalCode: d.postalCode || undefined
  };

  // 1) ¿Existe ya por teléfono? -> login/actualización.
  const byPhone = await prisma.bubuiCustomer.findUnique({ where: { phone } });
  if (byPhone) {
    try {
      const updated = await prisma.bubuiCustomer.update({ where: { id: byPhone.id }, data: { phoneVerified: true, ...profile } });
      return sessionFrom(updated, true);
    } catch (e: any) {
      if (e?.code === "P2002") {
        return NextResponse.json({ error: { code: "email_taken", message: "Ese email ya está en uso por otra cuenta." } }, { status: 409 });
      }
      throw e;
    }
  }

  // 2) ¿Existe por email (alta previa sin teléfono)? -> fusionar: añadir teléfono.
  const byEmail = await prisma.bubuiCustomer.findUnique({ where: { email: d.email } });
  if (byEmail) {
    if (byEmail.phone && byEmail.phone !== phone) {
      return NextResponse.json({ error: { code: "email_other_phone", message: "Ese email ya tiene cuenta con otro teléfono. Usa ese número o cambia de email." } }, { status: 409 });
    }
    const merged = await prisma.bubuiCustomer.update({ where: { id: byEmail.id }, data: { phone, phoneVerified: true, ...profile } });
    await ensureReferralCode(merged.id);
    if (d.ref) await applyReferral(merged.id, d.ref).catch(() => {});
    return sessionFrom(merged, true);
  }

  // 3) Crear nuevo.
  try {
    const created = await prisma.bubuiCustomer.create({
      data: { phone, phoneVerified: true, ...profile, firstBusinessId: d.firstBusinessId ?? null }
    });
    await ensureReferralCode(created.id);
    if (d.ref) await applyReferral(created.id, d.ref).catch(() => {});
    return sessionFrom(created, false, 201);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: { code: "email_taken", message: "Ese email ya está en uso. Inténtalo con otro." } }, { status: 409 });
    }
    throw e;
  }
}
