import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type UnsubscribePayload = { workspaceId: string; leadId: string; email: string; exp: number };

function secret() {
  const value = process.env.LEADS_UNSUBSCRIBE_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.CRON_SECRET;
  if (!value) throw new Error("Falta LEADS_UNSUBSCRIBE_SECRET (o NEXTAUTH_SECRET/CRON_SECRET)");
  return value;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(secret()).digest();
}

export function createUnsubscribeToken(payload: Omit<UnsubscribePayload, "exp">, lifetimeDays = 1825): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + lifetimeDays * 86_400_000 }), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  const [version, ivValue, encryptedValue, tagValue] = token.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue || !tagValue) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]);
    const payload = JSON.parse(plaintext.toString("utf8")) as UnsubscribePayload;
    if (!payload.workspaceId || !payload.leadId || !payload.email || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://hub.negociovivo.app").replace(/\/$/, "");
  return `${base}/api/public/leads/unsubscribe/${encodeURIComponent(token)}`;
}
