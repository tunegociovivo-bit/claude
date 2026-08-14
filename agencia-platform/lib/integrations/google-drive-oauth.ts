import crypto from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/drive openid email profile";

export function driveRedirectUri(): string {
  return `${(process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")}/api/integrations/google-drive/callback`;
}

export function signDriveState(payload: { userId: string; workspaceId: string; ts: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "dev").update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyDriveState(state: string): { userId: string; workspaceId: string; ts: number } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "dev").update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}

export function driveAuthorizeUrl(state: string): string {
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID no configurado");
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: driveRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  })}`;
}

export async function exchangeDriveCode(code: string): Promise<{ access_token: string; refresh_token?: string }> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error("Google OAuth no configurado");
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: driveRedirectUri(), grant_type: "authorization_code" })
  });
  if (!resp.ok) throw new Error(`Google OAuth ${resp.status}: ${(await resp.text()).slice(0, 250)}`);
  return resp.json();
}

export async function ensureBackupFolder(accessToken: string): Promise<string> {
  const name = "Hub Negocio Vivo — Copias de seguridad";
  const query = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
  const list = await fetch(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: query, fields: "files(id)", pageSize: "1" })}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!list.ok) throw new Error(`Drive list ${list.status}: ${(await list.text()).slice(0, 200)}`);
  const found = (await list.json()).files?.[0]?.id;
  if (found) return found;
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" })
  });
  if (!create.ok) throw new Error(`Drive folder ${create.status}: ${(await create.text()).slice(0, 200)}`);
  return (await create.json()).id;
}

export async function googleAccountEmail(accessToken: string): Promise<string> {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Google userinfo ${r.status}`);
  return (await r.json()).email;
}
