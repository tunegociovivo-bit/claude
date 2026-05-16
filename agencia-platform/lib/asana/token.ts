/**
 * Lectura/escritura del token de Asana con migración progresiva a
 * cifrado. Hay dos columnas en AsanaConnection:
 *   - `accessToken` (texto plano, legado).
 *   - `accessTokenEnc` (AES-GCM con encryptSecret(), preferida).
 *
 * Reglas:
 *   - readToken(conn): si hay enc, lo descifra; si solo hay plano,
 *     lo devuelve tal cual y dispara una migración en background
 *     (no bloquea) para encriptarlo y borrar el plano.
 *   - setToken(conn, plain): guarda solo en `accessTokenEnc` y
 *     vacía `accessToken` para que la cuenta quede limpia.
 */

import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";
import type { AsanaConnection } from "@prisma/client";

export function readAsanaToken(conn: AsanaConnection): string | null {
  if (conn.accessTokenEnc) {
    const plain = decryptSecret(conn.accessTokenEnc);
    if (plain) return plain;
  }
  if (conn.accessToken) {
    // Lazy migration: cifra y vacía el plano en background.
    void prisma.asanaConnection
      .update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encryptSecret(conn.accessToken),
          accessToken: "" // dejamos string vacío en la columna NOT NULL
        }
      })
      .catch(() => {});
    return conn.accessToken;
  }
  return null;
}

export async function saveAsanaToken(opts: {
  userId: string;
  token: string;
  asanaUserId?: string | null;
}): Promise<void> {
  const enc = encryptSecret(opts.token);
  const existing = await prisma.asanaConnection.findFirst({ where: { userId: opts.userId } });
  if (existing) {
    await prisma.asanaConnection.update({
      where: { id: existing.id },
      data: {
        accessTokenEnc: enc,
        accessToken: "",
        ...(opts.asanaUserId ? { asanaUserId: opts.asanaUserId } : {})
      }
    });
  } else {
    await prisma.asanaConnection.create({
      data: {
        userId: opts.userId,
        accessToken: "",
        accessTokenEnc: enc,
        asanaUserId: opts.asanaUserId ?? null
      }
    });
  }
}
