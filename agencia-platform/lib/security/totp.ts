/**
 * 2FA TOTP (RFC 6238) por usuario.
 *
 * Flujo de enrolamiento:
 *   1) startEnrollment(userId): genera un secret base32 nuevo, lo
 *      guarda en User.totpSecret (CIFRADO) pero NO setea totpEnabledAt
 *      todavía. Devuelve el secret + URL otpauth:// + dataURI del QR.
 *   2) Usuario escanea el QR con Google Authenticator / 1Password /
 *      Authy y nos manda un código de 6 dígitos.
 *   3) confirmEnrollment(userId, code): valida el código. Si OK,
 *      setea totpEnabledAt y genera 8 códigos de recuperación
 *      (bcrypt-hasheados en BD). Devuelve los códigos en CLARO solo
 *      esta vez para que el user los apunte.
 *
 * Login:
 *   4) verifyCode(userId, code): valida un código TOTP o uno de
 *      recuperación. Los códigos de recuperación se marcan como
 *      usados al consumir (single-use).
 *
 * El secret se cifra con encryptSecret/decryptSecret (AES-256-GCM
 * derivado de NEXTAUTH_SECRET). Si el secret se filtrara de BD sin
 * la app key, sigue siendo inútil.
 */

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";

// Tolerancia: aceptamos código actual + anterior + siguiente (window 1)
// para absorber relojes mal sincronizados sin abrir demasiado.
// Tolerancia simétrica en SEGUNDOS (no en ventanas como otplib v12).
// 30s ≈ 1 ventana hacia atrás/delante con period default de 30s.
const VERIFY_TOLERANCE_SEC = 30;
const ISSUER = process.env.NEXT_PUBLIC_APP_NAME ?? "Hub";

const BACKUP_CODES_COUNT = 8;
const BACKUP_CODE_LEN = 10; // hex chars (5 bytes)

export type BackupCodesEntry = { code: string; usedAt: string | null };
type StoredBackupCodes = { hash: string; usedAt: string | null }[];

export type EnrollmentStart = {
  secret: string;       // base32, mostrar al usuario como fallback si no escanea
  otpauthUrl: string;   // otpauth://totp/Hub:email?secret=...
  qrDataUri: string;    // PNG data:image/png;base64
};

export async function startEnrollment(userId: string): Promise<EnrollmentStart> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, totpEnabledAt: true }
  });
  if (!user) throw new Error("user_not_found");
  if (user.totpEnabledAt) throw new Error("totp_already_enabled");

  const secret = generateSecret();
  const otpauthUrl = generateURI({
    strategy: "totp",
    issuer: ISSUER,
    label: user.email,
    secret
  });
  const qrDataUri = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });

  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptSecret(secret) }
  });

  return { secret, otpauthUrl, qrDataUri };
}

export async function cancelEnrollment(userId: string): Promise<void> {
  // Solo borra si TODAVÍA no está activado — protege contra borrar el
  // secret de alguien con 2FA ya activo via este endpoint.
  await prisma.user.updateMany({
    where: { id: userId, totpEnabledAt: null },
    data: { totpSecret: null }
  });
}

export type ConfirmResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; reason: "no_pending" | "bad_code" };

export async function confirmEnrollment(userId: string, code: string): Promise<ConfirmResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true }
  });
  if (!user?.totpSecret || user.totpEnabledAt) {
    return { ok: false, reason: "no_pending" };
  }
  const secret = decryptSecret(user.totpSecret);
  if (!secret) return { ok: false, reason: "no_pending" };
  const r = verifySync({ token: code.trim(), secret, epochTolerance: VERIFY_TOLERANCE_SEC } as any);
  if (!r.valid) {
    return { ok: false, reason: "bad_code" };
  }

  // Genera N backup codes en claro, guarda solo los hashes.
  const plain: string[] = Array.from({ length: BACKUP_CODES_COUNT }, () =>
    crypto.randomBytes(BACKUP_CODE_LEN / 2).toString("hex")
  );
  const hashed: StoredBackupCodes = await Promise.all(
    plain.map(async (c) => ({ hash: await bcrypt.hash(c, 10), usedAt: null }))
  );

  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabledAt: new Date(),
      totpBackupCodes: hashed as any
    }
  });

  return { ok: true, backupCodes: plain };
}

export type VerifyResult =
  | { ok: true; usedBackupCode: boolean }
  | { ok: false; reason: "no_totp" | "bad_code" };

/**
 * Verifica un código en el contexto de login (2º factor). Acepta:
 *   - 6 dígitos: código TOTP del authenticator
 *   - 10 hex chars: código de recuperación (se consume)
 */
export async function verifyCode(userId: string, code: string): Promise<VerifyResult> {
  const trimmed = code.trim().replace(/\s+/g, "");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true, totpBackupCodes: true }
  });
  if (!user?.totpEnabledAt || !user.totpSecret) {
    return { ok: false, reason: "no_totp" };
  }

  // ¿Código TOTP de 6 dígitos?
  if (/^\d{6}$/.test(trimmed)) {
    const secret = decryptSecret(user.totpSecret);
    if (!secret) return { ok: false, reason: "no_totp" };
    const r = verifySync({ token: trimmed, secret, epochTolerance: VERIFY_TOLERANCE_SEC } as any);
    if (r.valid) return { ok: true, usedBackupCode: false };
    return { ok: false, reason: "bad_code" };
  }

  // ¿Código de recuperación?
  if (/^[a-f0-9]{10}$/i.test(trimmed)) {
    const list = (user.totpBackupCodes as StoredBackupCodes | null) ?? [];
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (entry.usedAt) continue;
      if (await bcrypt.compare(trimmed.toLowerCase(), entry.hash)) {
        list[i] = { ...entry, usedAt: new Date().toISOString() };
        await prisma.user.update({
          where: { id: userId },
          data: { totpBackupCodes: list as any }
        });
        return { ok: true, usedBackupCode: true };
      }
    }
    return { ok: false, reason: "bad_code" };
  }

  return { ok: false, reason: "bad_code" };
}

/** Lista los backup codes (solo metadata: cuáles ya se usaron). */
export async function listBackupCodes(userId: string): Promise<{ total: number; used: number; remaining: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpBackupCodes: true }
  });
  const list = (user?.totpBackupCodes as StoredBackupCodes | null) ?? [];
  const used = list.filter((c) => c.usedAt).length;
  return { total: list.length, used, remaining: list.length - used };
}

/** Desactiva 2FA. Borra secret + códigos. */
export async function disableTotp(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnabledAt: null, totpBackupCodes: undefined as any }
  });
}

/** ¿Tiene este user 2FA activo? Útil para gate en login. */
export async function hasTotp(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true }
  });
  return !!user?.totpEnabledAt;
}
