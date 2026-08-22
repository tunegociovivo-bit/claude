import { createHmac, timingSafeEqual } from "crypto";

const ALLOWED_PREFIXES = ["bubui/ai-banner/"];

function secret(): string {
  const value = process.env.AUTH_SECRET || process.env.CRON_SECRET;
  if (!value) throw new Error("Falta AUTH_SECRET o CRON_SECRET para firmar contenido público");
  return value;
}

function allowed(key: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix)) && !key.includes("..");
}

export function publicMediaUrl(origin: string, key: string): string {
  if (!allowed(key)) throw new Error("Ruta de contenido no permitida");
  const encoded = Buffer.from(key, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${origin.replace(/\/+$/, "")}/api/bubui/media/${encoded}?sig=${signature}`;
}

export function verifyPublicMedia(encoded: string, signature: string): string | null {
  const expected = createHmac("sha256", secret()).update(encoded).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const key = Buffer.from(encoded, "base64url").toString("utf8");
  return allowed(key) ? key : null;
}
