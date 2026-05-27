/**
 * Helpers de autorización a nivel de API. Complementan los scopes
 * (clients:read, etc.) con el concepto de "role del caller" — admin
 * humano vs miembro vs API key.
 *
 * Las API keys NO tienen role (son orthogonales): si una API key tiene
 * scope adecuado, asumimos que el dueño quiso ese acceso. La capa
 * "admin only" sólo se aplica a sesiones de usuario (api.userId
 * presente, api.apiKeyId ausente).
 */

import { prisma } from "@/lib/db/prisma";
import type { ApiContext } from "@/lib/api/auth";

export async function callerIsAdmin(api: ApiContext): Promise<boolean> {
  // API key → la respetamos como acceso completo (el dueño la creó
  // a propósito con scopes específicos).
  if (api.apiKeyId) return true;
  if (!api.userId) return false;
  const m = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId },
    select: { role: true }
  });
  return m?.role === "ADMIN";
}

// Quita `mrr` del objeto si el caller no es admin. Mutación shallow,
// no recursiva.
export function redactMrr<T extends Record<string, any>>(obj: T, isAdmin: boolean): T {
  if (isAdmin) return obj;
  const { mrr, ...rest } = obj as any;
  return rest as T;
}

export function redactMrrList<T extends Record<string, any>>(arr: T[], isAdmin: boolean): T[] {
  if (isAdmin) return arr;
  return arr.map((o) => redactMrr(o, false));
}
