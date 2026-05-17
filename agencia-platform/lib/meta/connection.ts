/**
 * Conexión Meta (Facebook/Instagram Ads) por usuario.
 *
 * El token de larga duración se cifra con NEXTAUTH_SECRET vía
 * encryptSecret/decryptSecret (mismo esquema que Asana y los API
 * keys de IA). Sin la app key, una filtración de BD no expone el
 * token utilizable.
 *
 * Por ahora el token se obtiene MANUALMENTE (lo pega el user en el
 * wizard, cogido de su Business Manager). En Fase 2 añadiremos
 * Facebook Login con scopes ads_management + leads_retrieval.
 */

import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";

export async function saveMetaToken(opts: {
  userId: string;
  workspaceId: string;
  accessToken: string;
  metaUserId?: string;
  expiresAt?: Date | null;
}): Promise<{ id: string }> {
  const enc = encryptSecret(opts.accessToken.trim());
  // upsert por (userId, workspaceId) — un user solo tiene una conexión
  // de Meta por workspace. Si quisiera cambiar de cuenta, sobrescribe.
  const r = await prisma.metaConnection.upsert({
    where: { userId_workspaceId: { userId: opts.userId, workspaceId: opts.workspaceId } },
    update: {
      accessTokenEnc: enc,
      metaUserId: opts.metaUserId ?? null,
      expiresAt: opts.expiresAt ?? null
    },
    create: {
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      accessTokenEnc: enc,
      metaUserId: opts.metaUserId ?? null,
      expiresAt: opts.expiresAt ?? null
    }
  });
  return { id: r.id };
}

export async function readMetaToken(
  userId: string,
  workspaceId: string
): Promise<string | null> {
  const conn = await prisma.metaConnection.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } }
  });
  if (!conn) return null;
  if (conn.expiresAt && conn.expiresAt < new Date()) return null;
  return decryptSecret(conn.accessTokenEnc);
}

export async function deleteMetaConnection(userId: string, workspaceId: string): Promise<void> {
  await prisma.metaConnection.deleteMany({ where: { userId, workspaceId } });
}

/**
 * Pequeña validación de smoke-test del token. Llama a /me en el Graph
 * API. Si responde 200, el token está vivo. La llamada se hace al
 * vuelo desde el endpoint de "Probar conexión" del wizard.
 */
export async function pingMetaToken(token: string): Promise<{ ok: boolean; metaUserId?: string; name?: string; error?: string }> {
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, error: j?.error?.message ?? `HTTP ${r.status}` };
    }
    const j = await r.json();
    return { ok: true, metaUserId: j.id, name: j.name };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Error desconocido" };
  }
}
