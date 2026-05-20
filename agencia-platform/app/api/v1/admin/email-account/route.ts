/**
 * GET    /api/v1/admin/email-account  → estado de la cuenta del USER caller
 * PUT    /api/v1/admin/email-account  → guarda config IMAP/SMTP + password
 * DELETE /api/v1/admin/email-account  → desconecta
 * POST   /api/v1/admin/email-account/test  → prueba conexión (en subruta)
 *
 * Cuenta de correo IMAP/SMTP por USUARIO (no por workspace). Sonia solo
 * la usa para ese usuario. La password se guarda cifrada.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { encryptSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  smtpSecure: z.boolean().default(true),
  loginUser: z.string().min(1),
  password: z.string().optional() // opcional al editar (mantiene la actual)
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const acc = await prisma.emailAccount.findUnique({
    where: { userId_workspaceId: { userId: api.userId, workspaceId: api.workspaceId } },
    select: {
      email: true,
      imapHost: true,
      imapPort: true,
      imapSecure: true,
      smtpHost: true,
      smtpPort: true,
      smtpSecure: true,
      loginUser: true,
      createdAt: true,
      lastError: true
    }
  });
  return NextResponse.json({ connected: !!acc, account: acc });
});

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const d = parsed.data;

  const existing = await prisma.emailAccount.findUnique({
    where: { userId_workspaceId: { userId: api.userId, workspaceId: api.workspaceId } }
  });
  if (!d.password && !existing) {
    throw new ApiError(400, "password_required", "La contraseña es obligatoria la primera vez.");
  }

  const data: any = {
    email: d.email,
    imapHost: d.imapHost,
    imapPort: d.imapPort,
    imapSecure: d.imapSecure,
    smtpHost: d.smtpHost,
    smtpPort: d.smtpPort,
    smtpSecure: d.smtpSecure,
    loginUser: d.loginUser,
    lastError: null
  };
  if (d.password) data.passwordEnc = encryptSecret(d.password);

  await prisma.emailAccount.upsert({
    where: { userId_workspaceId: { userId: api.userId, workspaceId: api.workspaceId } },
    create: { ...data, userId: api.userId, workspaceId: api.workspaceId, passwordEnc: data.passwordEnc ?? "" },
    update: data
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await prisma.emailAccount
    .delete({
      where: { userId_workspaceId: { userId: api.userId, workspaceId: api.workspaceId } }
    })
    .catch(() => {});
  return NextResponse.json({ ok: true });
});
