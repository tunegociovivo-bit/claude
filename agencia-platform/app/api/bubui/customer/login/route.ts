/**
 * POST /api/bubui/customer/login  { phone, code }
 *
 * Inicio de sesión sin necesidad de re-rellenar el perfil. Verifica el
 * código SMS y, si el teléfono ya existe en BubuiCustomer, devuelve la
 * sesión existente. Si no existe, responde 404 con un mensaje claro
 * para que el cliente redirija al flujo de alta.
 *
 * Idea: el usuario que se dio de alta una vez (y por lo tanto su
 * teléfono está verificado en la DB) puede entrar desde otro
 * dispositivo o tras un reinstall solo introduciendo su número.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { toE164, checkVerification, isReviewPhone } from "@/lib/bubui/twilio";
import { issueCustomerToken } from "@/lib/bubui/customer-auth";
import { rateLimit } from "@/lib/api/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({
  phone: z.string().min(6).max(40),
  code: z.string().min(4).max(10)
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "Datos inválidos" } },
      { status: 400 }
    );
  }
  const phone = toE164(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: { code: "bad_phone", message: "Número de teléfono no válido" } },
      { status: 400 }
    );
  }

  // Anti fuerza bruta: máx 6 intentos de código por minuto y teléfono.
  if (!rateLimit(`bubui-otp-check:${phone}`, 6).ok) {
    return NextResponse.json(
      { error: { code: "rate_limit", message: "Demasiados intentos. Espera un minuto." } },
      { status: 429 }
    );
  }

  const check = await checkVerification(phone, parsed.data.code);
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

  let c = await prisma.bubuiCustomer.findUnique({ where: { phone } });
  // Cuenta de revisión (App Store / Play): si aún no existe, la provisionamos
  // al vuelo para que el revisor pueda entrar solo con teléfono + código.
  if (!c && isReviewPhone(phone)) {
    const reviewEmail = process.env.BUBUI_REVIEW_EMAIL || "appreview@bubui.app";
    c = await prisma.bubuiCustomer.upsert({
      where: { email: reviewEmail },
      update: { phone, phoneVerified: true },
      create: { phone, phoneVerified: true, email: reviewEmail, name: "App Review", gender: "other" }
    });
  }
  if (!c) {
    return NextResponse.json(
      { error: { code: "not_registered", message: "No hay ninguna cuenta con ese número. Date de alta primero." } },
      { status: 404 }
    );
  }
  // Mantén phoneVerified al día por si la DB tuviera la flag a false.
  if (!c.phoneVerified) {
    await prisma.bubuiCustomer.update({ where: { id: c.id }, data: { phoneVerified: true } });
  }
  // Emite/renueva el token de sesión para esta (re)entrada.
  const token = await issueCustomerToken(c.id);
  return NextResponse.json({
    ok: true,
    customerId: c.id,
    name: c.name,
    totalSaved: c.totalSaved,
    totalPurchases: c.totalPurchases,
    token
  });
}
