/**
 * POST /api/bubui/customer/push-token/register
 *   { customerId, token, platform }
 *
 * Registra (upsert) un Expo Push Token para un cliente móvil. La app
 * llama a este endpoint tras hacer login o al volver al Feed cuando ya
 * tiene token.
 *
 * Si el token no es un Expo Push Token válido, respondemos 400 — la app
 * debería ignorar el error (caso típico: el dispositivo no tiene FCM
 * configurado y no se ha podido generar el token).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Expo } from "expo-server-sdk";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  customerId: z.string().min(1),
  token: z.string().min(8).max(200),
  platform: z.enum(["ios", "android"]).default("android")
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "Datos inválidos" } },
      { status: 400 }
    );
  }
  const { customerId, token, platform } = parsed.data;
  if (!Expo.isExpoPushToken(token)) {
    return NextResponse.json(
      { error: { code: "invalid_token", message: "Token no válido" } },
      { status: 400 }
    );
  }
  const exists = await prisma.bubuiCustomer.findUnique({
    where: { id: customerId },
    select: { id: true }
  });
  if (!exists) {
    return NextResponse.json(
      { error: { code: "customer_not_found", message: "Cliente no encontrado" } },
      { status: 404 }
    );
  }
  // Upsert por token: si ya existe pero pertenecía a otro cliente,
  // re-asignamos al cliente actual (caso típico: mismo dispositivo,
  // cliente distinto tras logout/login).
  await prisma.bubuiMobilePushToken.upsert({
    where: { token },
    update: { customerId, platform },
    create: { customerId, token, platform }
  });
  return NextResponse.json({ ok: true });
}
