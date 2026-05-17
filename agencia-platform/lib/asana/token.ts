/**
 * Lectura/escritura del token de Asana con migración progresiva a
 * cifrado. Hay dos columnas en AsanaConnection:
 *   - `accessToken` (texto plano, legado).
 *   - `accessTokenEnc` (AES-GCM con encryptSecret(), preferida).
 *
 * Reglas:
 *   - readToken(conn): si hay enc, lo descifra; si solo hay plano,
 *     lo devuelve tal cual y dispara una migración en background
 *     (no bloquea) para encriptarlo y borrar el plano. SIEMPRE trim
 *     antes de devolver — los tokens con \n o espacios fallaban en
 *     Asana porque van en el header Authorization tal cual.
 *   - setToken(conn, plain): guarda solo en `accessTokenEnc` y
 *     vacía `accessToken` para que la cuenta quede limpia. trim
 *     también antes de cifrar, así nunca se persiste basura.
 */

import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";
import type { AsanaConnection } from "@prisma/client";

// Normaliza un token de Asana: quita espacios, saltos de línea y BOM
// al principio/final. NUNCA toca el interior — los tokens son opacos
// y podrían en teoría tener cualquier carácter. La basura suele venir
// de copy-paste desde una doc / chat con un \n invisible al final.
function cleanToken(t: string | null | undefined): string | null {
  if (!t) return null;
  const trimmed = t.replace(/^﻿/, "").trim();
  return trimmed || null;
}

export function readAsanaToken(conn: AsanaConnection): string | null {
  if (conn.accessTokenEnc) {
    const plain = decryptSecret(conn.accessTokenEnc);
    if (plain) return cleanToken(plain);
  }
  if (conn.accessToken) {
    const clean = cleanToken(conn.accessToken);
    // Lazy migration: cifra el limpio y vacía el plano en background.
    if (clean) {
      void prisma.asanaConnection
        .update({
          where: { id: conn.id },
          data: {
            accessTokenEnc: encryptSecret(clean),
            accessToken: "" // dejamos string vacío en la columna NOT NULL
          }
        })
        .catch(() => {});
    }
    return clean;
  }
  return null;
}

export async function saveAsanaToken(opts: {
  userId: string;
  token: string;
  asanaUserId?: string | null;
}): Promise<void> {
  const clean = cleanToken(opts.token);
  if (!clean) throw new Error("Token vacío tras limpiar — comprueba que copiaste el token completo");
  const enc = encryptSecret(clean);
  // Borramos primero TODAS las filas que pueda haber del user — antes
  // hacíamos findFirst+update, lo que dejaba filas duplicadas si en
  // algún momento se crearon dos. Después insertamos una sola limpia.
  await prisma.asanaConnection.deleteMany({ where: { userId: opts.userId } });
  await prisma.asanaConnection.create({
    data: {
      userId: opts.userId,
      accessToken: "",
      accessTokenEnc: enc,
      asanaUserId: opts.asanaUserId ?? null
    }
  });
}
