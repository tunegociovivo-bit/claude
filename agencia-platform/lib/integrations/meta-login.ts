/**
 * Facebook Login en el Hub para obtener un token de USUARIO de larga
 * duración (60 días) con acceso TOTAL a las cuentas de Meta del usuario —
 * lo que el Usuario del Sistema no alcanza. Se guarda como la conexión Meta
 * del workspace (saveMetaToken), así TODO el Hub (campañas, leads, insights,
 * Sonia autónoma) lo usa automáticamente. Un cron lo renueva antes de
 * caducar → 100% autónomo tras un único login.
 *
 * Requisito: una App de Facebook (META_APP_ID + META_APP_SECRET) con
 * Facebook Login y el redirect URI de /callback. Sirve la misma app de la
 * que ya sacas el token del Usuario del Sistema.
 */
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";
import { saveMetaToken } from "@/lib/meta/connection";

const GRAPH = "https://graph.facebook.com/v21.0";
const DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";
const SCOPES = "ads_management,ads_read,business_management,leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_engagement";

export function metaAppConfigured(): boolean {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function metaLoginRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.negociovivo.app").replace(/\/+$/, "");
  return `${base}/api/v1/admin/integrations/meta-login/callback`;
}

export function buildMetaLoginUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: metaLoginRedirectUri(),
    state,
    response_type: "code",
    scope: SCOPES
  });
  return `${DIALOG}?${params.toString()}`;
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) {
    throw new Error(data?.error?.message ?? `Graph ${r.status}`);
  }
  return data;
}

/** Intercambia el code por un token de usuario de larga duración. */
async function codeToLongLived(code: string): Promise<{ token: string; expiresIn: number }> {
  const id = process.env.META_APP_ID!;
  const secret = process.env.META_APP_SECRET!;
  const redirect = metaLoginRedirectUri();
  // code → token corto
  const short = await getJson(
    `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(
      redirect
    )}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}`
  );
  // token corto → token largo (60 días)
  const long = await getJson(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(
      id
    )}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(short.access_token)}`
  );
  return { token: long.access_token as string, expiresIn: Number(long.expires_in ?? 5184000) };
}

/** Renueva un token de larga duración (extiende otros ~60 días). */
async function extendLongLived(token: string): Promise<{ token: string; expiresIn: number }> {
  const id = process.env.META_APP_ID!;
  const secret = process.env.META_APP_SECRET!;
  const data = await getJson(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(
      id
    )}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(token)}`
  );
  return { token: data.access_token as string, expiresIn: Number(data.expires_in ?? 5184000) };
}

/** Tras el callback: guarda el token de usuario como conexión Meta del workspace. */
export async function handleMetaLoginCallback(opts: {
  workspaceId: string;
  userId: string;
  code: string;
}): Promise<{ metaUserId?: string; name?: string }> {
  const { token, expiresIn } = await codeToLongLived(opts.code);
  const me = await getJson(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
  await saveMetaToken({
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    accessToken: token,
    metaUserId: me.id,
    expiresAt: new Date(Date.now() + expiresIn * 1000)
  });
  return { metaUserId: me.id, name: me.name };
}

/**
 * Renueva los tokens de usuario del Hub que estén próximos a caducar
 * (<14 días). Llamado por el planificador interno. No-op si no hay app
 * configurada o si no toca renovar. Idempotente y barato.
 */
export async function refreshMetaUserTokensIfNeeded(): Promise<{ refreshed: number }> {
  if (!metaAppConfigured()) return { refreshed: 0 };
  const soon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const conns = await prisma.metaConnection.findMany({
    where: { expiresAt: { not: null, lte: soon } }
  });
  let refreshed = 0;
  for (const c of conns) {
    try {
      const current = decryptSecret(c.accessTokenEnc);
      if (!current) continue;
      const { token, expiresIn } = await extendLongLived(current);
      await saveMetaToken({
        userId: c.userId,
        workspaceId: c.workspaceId,
        accessToken: token,
        metaUserId: c.metaUserId ?? undefined,
        expiresAt: new Date(Date.now() + expiresIn * 1000)
      });
      refreshed++;
    } catch (e) {
      console.warn("[meta-login] refresh falló para conn", c.id, (e as Error).message);
    }
  }
  return { refreshed };
}
