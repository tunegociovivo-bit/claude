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

/**
 * Devuelve la conexión ACTIVA del user — la más reciente.
 *
 * AsanaConnection no tiene UNIQUE en userId, así que históricamente
 * pudieron acumularse varias filas por el mismo usuario (saveAsanaToken
 * solo hace deleteMany+create desde mid-2026; antes era findFirst+
 * update y dejaba filas huérfanas).
 *
 * Sin orderBy explícito, findFirst es no-determinístico: una llamada
 * elige la fila A (token válido), otra elige la fila B (token caducado)
 * y el usuario ve "modo automático" funcionando para listar workspaces
 * pero fallando al listar projects con 401.
 *
 * Este helper:
 *   1. Ordena DESC por createdAt → siempre la más reciente
 *   2. BORRA todas las anteriores en background (idempotente)
 *   3. Devuelve la fila ganadora
 */
export async function getActiveAsanaConnection(
  userId: string
): Promise<AsanaConnection | null> {
  const conns = await prisma.asanaConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });
  if (conns.length === 0) return null;
  const active = conns[0];
  // Cleanup en background: borrar los duplicados viejos.
  if (conns.length > 1) {
    const oldIds = conns.slice(1).map((c) => c.id);
    void prisma.asanaConnection
      .deleteMany({ where: { id: { in: oldIds } } })
      .catch(() => {});
  }
  return active;
}

/**
 * Helper combinado: getActiveAsanaConnection + readAsanaToken.
 * Devuelve el token plano listo para usar, o null si no hay conexión.
 */
export async function getActiveAsanaToken(userId: string): Promise<string | null> {
  const conn = await getActiveAsanaConnection(userId);
  if (!conn) return null;
  return readAsanaToken(conn);
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
