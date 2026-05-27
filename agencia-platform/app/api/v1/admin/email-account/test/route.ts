/**
 * POST /api/v1/admin/email-account/test
 *
 * Prueba la conexión IMAP+SMTP. Si se pasa `password` la usa; si no,
 * usa la guardada del usuario. Devuelve { imap, smtp, error }.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { decryptSecret } from "@/lib/ai/crypto";
import { testEmailAccount } from "@/lib/integrations/email-account";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  email: z.string().email().optional(),
  imapHost: z.string().optional(),
  imapPort: z.number().int().optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().optional(),
  smtpSecure: z.boolean().optional(),
  loginUser: z.string().optional(),
  password: z.string().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const d = parsed.data;

  // Si faltan campos, completamos con la cuenta guardada.
  const saved = await prisma.emailAccount.findUnique({
    where: { userId_workspaceId: { userId: api.userId, workspaceId: api.workspaceId } }
  });
  const password = d.password || (saved ? decryptSecret(saved.passwordEnc) ?? "" : "");
  if (!password) throw new ApiError(400, "no_password", "Falta la contraseña para probar.");

  const { getResendConfig } = await import("@/lib/integrations/email");
  const relayAvailable = !!(await getResendConfig(api.workspaceId)).apiKey;

  const result = await testEmailAccount({
    imapHost: d.imapHost ?? saved?.imapHost ?? "",
    imapPort: d.imapPort ?? saved?.imapPort ?? 993,
    imapSecure: d.imapSecure ?? saved?.imapSecure ?? true,
    smtpHost: d.smtpHost ?? saved?.smtpHost ?? "",
    smtpPort: d.smtpPort ?? saved?.smtpPort ?? 465,
    smtpSecure: d.smtpSecure ?? saved?.smtpSecure ?? true,
    loginUser: d.loginUser ?? saved?.loginUser ?? d.email ?? "",
    password,
    relayAvailable
  });
  // Self-heal: si SMTP funcionó por un puerto distinto al guardado, lo
  // persistimos para que el próximo envío vaya directo.
  if (
    saved &&
    result.smtp &&
    result.smtpPort &&
    (saved.smtpPort !== result.smtpPort || saved.smtpSecure !== result.smtpSecure)
  ) {
    await prisma.emailAccount
      .update({
        where: { id: saved.id },
        data: { smtpPort: result.smtpPort, smtpSecure: !!result.smtpSecure }
      })
      .catch(() => {});
  }
  return NextResponse.json(result);
});
