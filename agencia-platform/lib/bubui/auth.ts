/** Verified stored credentials are required, including legacy accounts. */

import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { businessAuthMode, decideNoToken } from "./auth-mode";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function businessTokenAllows(token: string | null, businessId: string, options: { requireStoredToken?: boolean } = {}): Promise<boolean> {
  if (!token) return false;
  const m = /^Bearer\s+([\w-]+):([\w-]+)$/.exec(token.trim());
  if (!m || m[1] !== businessId) return false;
  const secret = m[2];

  const b = await prisma.bubuiBusiness.findUnique({ where: { id: businessId }, select: { apiToken: true } });
  if (!b) return false;

  if (b.apiToken) {
    // Negocio con sesión nueva → secreto obligatorio y correcto.
    return safeEqual(b.apiToken, secret);
  }
  // Negocio todavía sin apiToken (sesión previa a esta versión): decisión por modo.
  if (options.requireStoredToken) return false;
  const { allow, log } = decideNoToken(businessAuthMode());
  if (log) {
    console.warn(
      `[bubui-auth][shadow] negocio ${businessId} sin apiToken: se PERMITE (lazy/shadow). En modo strict devolvería 401.`
    );
  }
  return allow;
}
