import crypto from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/adwords openid email profile";

function clientId() { return process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ""; }
function clientSecret() { return process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || ""; }
function redirectUri() { return `${(process.env.NEXTAUTH_URL || "").replace(/\/$/, "")}/api/integrations/google-ads/callback`; }

export function googleAdsOAuthIssue(): string | null {
  if (!process.env.NEXTAUTH_URL || !process.env.NEXTAUTH_SECRET) return "server";
  if (!clientId() || !clientSecret()) return "google_credentials";
  return null;
}

export type GoogleAdsOAuthState = { userId: string; workspaceId: string; accountEmail: string; managerId: string; label: string; ts: number };

export function signGoogleAdsState(payload: GoogleAdsOAuthState) {
  if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET no configurado");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyGoogleAdsState(value: string): GoogleAdsOAuthState | null {
  const [body, signature] = value.split(".");
  if (!body || !signature || !process.env.NEXTAUTH_SECRET) return null;
  const expected = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET).update(body).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}

export function googleAdsAuthorizeUrl(state: string, accountEmail: string) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId(), redirect_uri: redirectUri(), response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", login_hint: accountEmail, state })}`;
}

export async function exchangeGoogleAdsCode(code: string): Promise<{ access_token: string; refresh_token?: string }> {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri(), grant_type: "authorization_code" }) });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${(await response.text()).slice(0, 250)}`);
  return response.json();
}

export async function googleAdsAccountEmail(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google userinfo ${response.status}`);
  return String((await response.json()).email || "").toLowerCase();
}
