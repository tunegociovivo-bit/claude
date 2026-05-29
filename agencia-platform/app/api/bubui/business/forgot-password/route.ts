/**
 * POST /api/bubui/business/forgot-password  { email }
 *
 * Genera un token de un solo uso (válido 1h), guarda su hash en el negocio
 * y envía por email el enlace de restablecimiento. Para evitar enumeración
 * de cuentas, SIEMPRE responde { ok: true } aunque el email no exista o el
 * envío no esté configurado.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { sendPasswordResetEmail } from "@/lib/bubui/email";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email() });

const PUBLIC_URL = process.env.NEXT_PUBLIC_BUBUI_URL || "https://bubui.app";

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: "Email no válido" } }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase().trim();
  const business = await prisma.bubuiBusiness.findUnique({ where: { ownerEmail: email } });

  if (business) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await prisma.bubuiBusiness.update({
      where: { id: business.id },
      data: {
        ownerResetTokenHash: tokenHash,
        ownerResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });
    const resetUrl = `${PUBLIC_URL}/negocio/reset?token=${token}`;
    // No bloqueamos la respuesta si el email tarda/falla.
    await sendPasswordResetEmail({ to: business.ownerEmail, resetUrl });
  }

  return NextResponse.json({ ok: true });
}
