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

const workspaceTokenCache = new Map<string, { token: string; until: number }>();

export async function saveMetaToken(opts: {
  userId: string;
  workspaceId: string;
  accessToken: string;
  metaUserId?: string;
  displayName?: string;
  connectionId?: string;
  expiresAt?: Date | null;
}): Promise<{ id: string }> {
  workspaceTokenCache.delete(opts.workspaceId);
  const enc = encryptSecret(opts.accessToken.trim());
  // upsert por (userId, workspaceId) — un user solo tiene una conexión
  // de Meta por workspace. Si quisiera cambiar de cuenta, sobrescribe.
  const existing = opts.connectionId
    ? await prisma.metaConnection.findFirst({ where: { id: opts.connectionId, workspaceId: opts.workspaceId } })
    : opts.metaUserId
      ? await prisma.metaConnection.findUnique({ where: { workspaceId_metaUserId: { workspaceId: opts.workspaceId, metaUserId: opts.metaUserId } } })
      : null;
  const tokenData = {
      userId: opts.userId,
      accessTokenEnc: enc,
      metaUserId: opts.metaUserId ?? null,
      displayName: opts.displayName ?? null,
      expiresAt: opts.expiresAt ?? null
  };
  const r = existing ? await prisma.metaConnection.update({ where: { id: existing.id }, data: tokenData }) : await prisma.metaConnection.create({ data: {
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      ...tokenData
    } });

  // Limpieza: borra OTRAS conexiones Meta del workspace que estén CADUCADAS.
  // Sin esto, una OAuth vieja vencida podía "ganar" la selección y el runner
  // operaba con un token muerto aunque acabaras de guardar uno bueno.
  try {
    await prisma.metaConnection.deleteMany({
      where: { workspaceId: opts.workspaceId, id: { not: r.id }, expiresAt: { lt: new Date() } }
    });
  } catch {
    /* best-effort */
  }

  // El runner autónomo (Sonia) PREFIERE las credenciales ad-hoc del
  // workspace sobre la conexión. Guardamos aquí el token bueno como ad-hoc
  // (cifrado) para que TODAS las tareas de Meta usen este token y nunca un
  // token provisional viejo que quedó en settings.adhocCredentials.
  try {
    const { persistAdhocCredentials } = await import("@/lib/ai/nv-ia/adhoc-credentials");
    await persistAdhocCredentials(opts.workspaceId, { META_ADS_TOKEN: opts.accessToken.trim() });
  } catch {
    /* best-effort */
  }

  return { id: r.id };
}

export async function readMetaToken(
  userId: string,
  workspaceId: string
): Promise<string | null> {
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

export async function listWorkspaceMetaTokens(workspaceId: string): Promise<Array<{ id: string; metaUserId: string | null; displayName: string | null; token: string }>> {
  const connections = await prisma.metaConnection.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } });
  const now = new Date();
  return connections.filter((item) => !item.expiresAt || item.expiresAt > now).flatMap((item) => {
    try {
      const token = decryptSecret(item.accessTokenEnc);
      return token ? [{ id: item.id, metaUserId: item.metaUserId, displayName: item.displayName, token }] : [];
    } catch { return []; }
  });
}

/**
 * Token Meta a nivel de WORKSPACE (no por usuario): "el token que no
 * caduca que ya tienes guardado". Lo resuelve de dos sitios, en orden:
 *   1. Cualquier MetaConnection vigente del workspace (la System User
 *      que pegó alguien — vale para todos).
 *   2. La credencial ad-hoc META_ADS_TOKEN guardada en el workspace.
 *
 * Sirve para que, si el usuario actual NO añade su propio token en el
 * modal de "Conexión Meta", se pueda crear/lanzar la campaña con el
 * token permanente ya guardado.
 */
export async function readWorkspaceMetaToken(workspaceId: string): Promise<string | null> {
  const cached = workspaceTokenCache.get(workspaceId);
  if (cached && cached.until > Date.now()) return cached.token;
  workspaceTokenCache.delete(workspaceId);
  const conns = await prisma.metaConnection.findMany({
    where: { workspaceId },
    // Una reautorización actualiza la fila existente, no su createdAt.
    // Priorizar updatedAt evita que otra conexión manual antigua del mismo
    // workspace gane frente al OAuth que el admin acaba de renovar.
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
  try {
    const { loadStoredAdhocCredentials } = await import("@/lib/ai/nv-ia/adhoc-credentials");
    const adhoc = await loadStoredAdhocCredentials(workspaceId);
    if (adhoc.META_ADS_TOKEN && (await pingMetaToken(adhoc.META_ADS_TOKEN)).ok) {
      workspaceTokenCache.set(workspaceId, { token: adhoc.META_ADS_TOKEN, until: Date.now() + 5 * 60 * 1000 });
      return adhoc.META_ADS_TOKEN;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

export async function deleteMetaConnection(userId: string, workspaceId: string, connectionId?: string): Promise<void> {
  workspaceTokenCache.delete(workspaceId);
  await prisma.metaConnection.deleteMany({ where: { userId, workspaceId, ...(connectionId ? { id: connectionId } : {}) } });
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
