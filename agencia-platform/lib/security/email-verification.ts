/**
 * Flujo de verificación de email. Usa el modelo VerificationToken
 * que NextAuth ya tiene en el schema (lo emplea para magic links;
 * aquí lo reusamos sin colisionar — identifier es siempre el email,
 * el token es opaco).
 *
 * Patrón:
 *   1) requestEmailVerification(userId) genera un token, lo guarda
 *      con expiry 24h y manda un correo con link
 *      https://hub.../verify-email?token=...
 *   2) consumeEmailVerification(token) valida y marca
 *      User.emailVerified = now(). Borra el token tras usar.
 *
 * Sin RESEND_API_KEY el "envío" loggea el link en consola — útil en
 * desarrollo y para el primer admin del workspace que aún no tiene
 * email configurado.
 */

import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";

const TOKEN_BYTES = 32;
const EXPIRY_HOURS = 24;

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  );
}

export async function requestEmailVerification(userId: string): Promise<{ sent: boolean; debugUrl?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerified: true }
  });
  if (!user) throw new Error("user_not_found");
  // Si ya está verificado y no hay un re-check forzado, no spammear.
  if (user.emailVerified) {
    return { sent: false };
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const expires = new Date(Date.now() + EXPIRY_HOURS * 3600_000);

  // Limpia tokens anteriores del mismo identifier para que un usuario
  // que pide reenvío no acumule basura ni pueda reusar tokens viejos.
  await prisma.verificationToken.deleteMany({
    where: { identifier: user.email }
  });
  await prisma.verificationToken.create({
    data: { identifier: user.email, token, expires }
  });

  const url = `${appOrigin()}/verify-email?token=${token}`;

  if (!isEmailEnabled()) {
    // En dev sin RESEND_API_KEY: loggeamos el link para que el dev
    // lo pueda abrir manualmente.
    console.warn(`[email-verify] RESEND_API_KEY no configurado. URL para ${user.email}:\n${url}`);
    return { sent: false, debugUrl: url };
  }

  await sendEmail({
    to: user.email,
    subject: "Verifica tu email — Hub",
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h1 style="font-size: 20px; color: #0f172a; margin: 0 0 16px;">Verifica tu email</h1>
        <p style="color: #475569; line-height: 1.6;">
          Hola${user.name ? ` ${user.name}` : ""},
        </p>
        <p style="color: #475569; line-height: 1.6;">
          Acabas de crear tu cuenta en Hub. Pulsa el botón para confirmar que esta es tu
          dirección de correo. El enlace caduca en 24 horas.
        </p>
        <p style="margin: 32px 0;">
          <a href="${url}" style="background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 500;">
            Verificar email
          </a>
        </p>
        <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">
          Si no funciona el botón, copia este enlace:<br>
          <a href="${url}" style="color: #4f46e5; word-break: break-all;">${url}</a>
        </p>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">
          ¿No has creado tú esta cuenta? Ignora este mensaje y la cuenta caducará.
        </p>
      </div>
    `,
    text: `Verifica tu email — Hub\n\n${url}\n\nCaduca en 24h. Si no fuiste tú, ignora este mensaje.`
  });

  return { sent: true };
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not_found" | "expired" | "user_gone" };

export async function consumeEmailVerification(token: string): Promise<ConsumeResult> {
  if (!token || token.length !== TOKEN_BYTES * 2) {
    return { ok: false, reason: "not_found" };
  }
  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record) return { ok: false, reason: "not_found" };
  if (record.expires < new Date()) {
    // Limpieza oportunista
    await prisma.verificationToken
      .delete({ where: { token } })
      .catch(() => {});
    return { ok: false, reason: "expired" };
  }
  const user = await prisma.user.findUnique({ where: { email: record.identifier } });
  if (!user) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
    return { ok: false, reason: "user_gone" };
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date(), emailVerificationRequiredAt: null }
    }),
    prisma.verificationToken.delete({ where: { token } })
  ]);
  return { ok: true, userId: user.id };
}
