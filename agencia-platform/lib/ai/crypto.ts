import crypto from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET ?? "fallback-do-not-use-in-prod-fallback";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string | null {
  try {
    const [ivb, tagb, ctb] = payload.split(".");
    const iv = Buffer.from(ivb, "base64");
    const tag = Buffer.from(tagb, "base64");
    const ct = Buffer.from(ctb, "base64");
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskSecret(token: string): string {
  if (!token) return "";
  if (token.length <= 12) return "•••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
