import crypto from "crypto";

const ALGO = "aes-256-gcm";

/**
 * Claves candidatas para el vault de secretos, en orden de preferencia.
 *
 * FASE 1 · Punto 6 — separación SECRETS_ENC_KEY / NEXTAUTH_SECRET:
 *  - Antes la clave se derivaba SIEMPRE de NEXTAUTH_SECRET y, si faltaba, de una
 *    CONSTANTE PÚBLICA ("fallback-do-not-use-in-prod") → cualquiera con el código
 *    podía descifrar el vault. Esa constante se ha ELIMINADO: si no hay ninguna
 *    clave configurada lanzamos, no ciframos con un secreto conocido.
 *  - Ahora se prefiere una clave DEDICADA `SECRETS_ENC_KEY`, desacoplada de
 *    NEXTAUTH_SECRET, para que rotar el secreto de sesión (JWT) NO destruya el
 *    vault de credenciales.
 *
 * Rollout sin caída (ver SECURITY-PHASE1.md):
 *  - Mientras `SECRETS_ENC_KEY` no esté puesta, se sigue usando NEXTAUTH_SECRET
 *    (exactamente lo que cifró los datos actuales) → cero rotura al desplegar.
 *  - Al poner `SECRETS_ENC_KEY`, los NUEVOS cifrados usan esa clave, pero el
 *    descifrado PRUEBA TODAS las candidatas, así los datos antiguos (cifrados con
 *    NEXTAUTH_SECRET) se siguen leyendo. Un re-cifrado posterior es opcional.
 */
function keyCandidates(): Buffer[] {
  const raw = [process.env.SECRETS_ENC_KEY, process.env.NEXTAUTH_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  if (raw.length === 0) {
    // SIN fallback público: es preferible fallar (y que el validador de config
    // lo grite) a cifrar credenciales con una clave que está en el repositorio.
    throw new Error(
      "Cifrado de secretos no configurado: define SECRETS_ENC_KEY (recomendado) o NEXTAUTH_SECRET."
    );
  }
  const seen = new Set<string>();
  const keys: Buffer[] = [];
  for (const s of raw) {
    if (seen.has(s)) continue;
    seen.add(s);
    keys.push(crypto.createHash("sha256").update(s).digest());
  }
  return keys;
}

export function encryptSecret(plain: string): string {
  const key = keyCandidates()[0]; // cifra con la clave preferida (SECRETS_ENC_KEY si existe)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string | null {
  const [ivb, tagb, ctb] = payload.split(".");
  if (!ivb || !tagb || !ctb) return null;
  let iv: Buffer, tag: Buffer, ct: Buffer;
  try {
    iv = Buffer.from(ivb, "base64");
    tag = Buffer.from(tagb, "base64");
    ct = Buffer.from(ctb, "base64");
  } catch {
    return null;
  }
  // Prueba cada clave candidata (soporta rotación / migración sin perder datos):
  // primero SECRETS_ENC_KEY, luego NEXTAUTH_SECRET. Si no hay NINGUNA clave
  // configurada, devolvemos null (no lanzamos) — descifrar sin clave = fallo,
  // no excepción, igual que antes.
  let candidates: Buffer[];
  try {
    candidates = keyCandidates();
  } catch {
    return null;
  }
  for (const key of candidates) {
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch {
      // clave incorrecta para este ciphertext → prueba la siguiente
    }
  }
  return null;
}

export function maskSecret(token: string): string {
  if (!token) return "";
  if (token.length <= 12) return "•••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
