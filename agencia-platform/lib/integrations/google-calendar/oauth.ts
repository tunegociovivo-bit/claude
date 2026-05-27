/**
 * OAuth flow contra Google para acceder al Calendar API. No usamos
 * el GoogleProvider de next-auth porque éste sólo gestiona login;
 * aquí necesitamos el scope `calendar` y conservar el refresh_token
 * de forma independiente.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   NEXTAUTH_URL  (para construir el redirect_uri)
 *
 * Almacenamos los tokens cifrados con lib/ai/crypto.ts en la tabla
 * GoogleCalendarConnection. El refresh_token solo lo manda Google
 * la primera vez (a no ser que pidamos prompt=consent), así que
 * forzamos consent en cada conexión para garantizar tenerlo.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar openid email profile";

export function googleOAuthRedirectUri(): string {
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  return `${base}/api/integrations/google-calendar/callback`;
}

export function googleAuthorizeUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID no configurado");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleOAuthRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // imprescindible para que vuelva a darnos refresh_token
    state,
    include_granted_scopes: "true"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
  scope: string;
};

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth no configurado");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleOAuthRedirectUri(),
      grant_type: "authorization_code"
    }).toString()
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Google token exchange falló (${r.status}): ${text.slice(0, 200)}`);
  }
  return r.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth no configurado");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }).toString()
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Google token refresh falló (${r.status}): ${text.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Revoca el refresh_token (cierra la conexión también del lado de
 * Google). Tras esto el access_token y el refresh_token quedan
 * inservibles. Si Google responde 400 (ya invalidado) lo damos por
 * bueno.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }).toString()
  }).catch(() => {});
}

export async function getUserInfo(accessToken: string): Promise<{ email: string; name?: string }> {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error(`Google userinfo falló (${r.status})`);
  const data = await r.json();
  return { email: data.email, name: data.name };
}
