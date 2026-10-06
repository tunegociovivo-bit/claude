/**
 * Conexión Meta (Facebook/Instagram) del negocio. Portado del Hub
 * (lib/meta/connection.ts).
 *
 * El token se cifra con encryptSecret/decryptSecret (ENCRYPTION_KEY del CRM).
 * Sin la clave de la app, una filtración de BD no expone un token utilizable.
 *
 * El token se obtiene MANUALMENTE: el administrador del negocio lo pega desde
 * su Business Manager (usuario del sistema o token de página). En el CRM la
 * conexión es del workspace (un negocio = una marca), así que `userId` solo
 * queda como referencia de quién la guardó.
 */

import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";

const workspaceTokenCache = new Map<string, { token: string; until: number }>();

export async function saveMetaToken(opts: {
  userId?: string | null;
  workspaceId: string;
  accessToken: string;
  metaUserId?: string;
  displayName?: string;
  connectionId?: string;
  expiresAt?: Date | null;
}): Promise<{ id: string }> {
  workspaceTokenCache.delete(opts.workspaceId);
  const enc = encryptSecret(opts.accessToken.trim());
  // upsert por (workspaceId, metaUserId): si se pega otra vez el token de la
  // misma cuenta Meta, se sobrescribe en vez de duplicar la conexión.
  const existing = opts.connectionId
    ? await prisma.metaConnection.findFirst({ where: { id: opts.connectionId, workspaceId: opts.workspaceId } })
    : opts.metaUserId
      ? await prisma.metaConnection.findUnique({ where: { workspaceId_metaUserId: { workspaceId: opts.workspaceId, metaUserId: opts.metaUserId } } })
      : null;
  const tokenData = {
    userId: opts.userId ?? null,
    accessTokenEnc: enc,
    metaUserId: opts.metaUserId ?? null,
    displayName: opts.displayName ?? null,
    expiresAt: opts.expiresAt ?? null
  };
  const r = existing
    ? await prisma.metaConnection.update({ where: { id: existing.id }, data: tokenData })
    : await prisma.metaConnection.create({ data: { workspaceId: opts.workspaceId, ...tokenData } });

  // Limpieza: borra OTRAS conexiones Meta del workspace que estén CADUCADAS.
  // Sin esto, una conexión vieja vencida podía "ganar" la selección y se
  // operaba con un token muerto aunque acabaras de guardar uno bueno.
  try {
    await prisma.metaConnection.deleteMany({
      where: { workspaceId: opts.workspaceId, id: { not: r.id }, expiresAt: { lt: new Date() } }
    });
  } catch {
    /* best-effort */
  }

  return { id: r.id };
}

export async function readMetaToken(userId: string, workspaceId: string): Promise<string | null> {
  const conn = await prisma.metaConnection.findFirst({ where: { userId, workspaceId }, orderBy: { updatedAt: "desc" } });
  if (!conn) return null;
  if (conn.expiresAt && conn.expiresAt < new Date()) return null;
  return decryptSecret(conn.accessTokenEnc);
}

export async function readMetaTokenByConnection(workspaceId: string, connectionId?: string | null): Promise<string | null> {
  if (!connectionId) return readWorkspaceMetaToken(workspaceId);
  const connection = await prisma.metaConnection.findFirst({ where: { id: connectionId, workspaceId } });
  if (!connection || (connection.expiresAt && connection.expiresAt < new Date())) return null;
  return decryptSecret(connection.accessTokenEnc);
}

export async function listWorkspaceMetaTokens(
  workspaceId: string
): Promise<Array<{ id: string; metaUserId: string | null; displayName: string | null; token: string }>> {
  const connections = await prisma.metaConnection.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } });
  const now = new Date();
  return connections
    .filter((item) => !item.expiresAt || item.expiresAt > now)
    .flatMap((item) => {
      try {
        const token = decryptSecret(item.accessTokenEnc);
        return token ? [{ id: item.id, metaUserId: item.metaUserId, displayName: item.displayName, token }] : [];
      } catch {
        return [];
      }
    });
}

/**
 * Token Meta a nivel de WORKSPACE: cualquier MetaConnection vigente del
 * negocio (la que pegó el administrador). En el Hub además se miraba la
 * credencial ad-hoc de Sonia; en el CRM no existe.
 */
export async function readWorkspaceMetaToken(workspaceId: string): Promise<string | null> {
  const cached = workspaceTokenCache.get(workspaceId);
  if (cached && cached.until > Date.now()) return cached.token;
  workspaceTokenCache.delete(workspaceId);
  const conns = await prisma.metaConnection.findMany({
    where: { workspaceId },
    // Al volver a pegar el token se actualiza la fila existente, no su
    // createdAt: priorizar updatedAt para usar siempre el más reciente.
    orderBy: { updatedAt: "desc" }
  });
  const now = new Date();
  const candidates = conns.filter((c) => !c.expiresAt || c.expiresAt > now);
  for (const candidate of candidates) {
    try {
      const token = decryptSecret(candidate.accessTokenEnc);
      if (token && (await pingMetaToken(token)).ok) {
        workspaceTokenCache.set(workspaceId, { token, until: Date.now() + 5 * 60 * 1000 });
        return token;
      }
    } catch {
      /* prueba la siguiente conexión */
    }
  }
  return null;
}

/** Borra la conexión (o todas) del negocio. Solo administradores. */
export async function deleteMetaConnection(workspaceId: string, connectionId?: string): Promise<number> {
  workspaceTokenCache.delete(workspaceId);
  const r = await prisma.metaConnection.deleteMany({ where: { workspaceId, ...(connectionId ? { id: connectionId } : {}) } });
  return r.count;
}

/**
 * Pequeña validación de smoke-test del token. Llama a /me en el Graph
 * API. Si responde 200, el token está vivo. Funciona con tokens de usuario
 * del sistema (devuelve el usuario) y con tokens de página (devuelve la página).
 */
export async function pingMetaToken(token: string): Promise<{ ok: boolean; metaUserId?: string; name?: string; error?: string }> {
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(15000)
    });
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
