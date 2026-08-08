/**
 * Logger local con SANEADO obligatorio. Antes de escribir nada, se redactan
 * patrones que pudieran ser sensibles (IBAN completo, tokens, cookies, OTP,
 * emails, largos de dígitos). Los logs se guardan en ./logs/agent-YYYYMMDD.log
 * y también se emiten por consola.
 *
 * REGLA: el agente NO lee ni registra credenciales; este saneado es una segunda
 * barrera defensiva por si algún dato llegara a un mensaje por error.
 */
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const LOG_DIR = resolve(process.cwd(), "logs");

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Redacta posibles secretos de una cadena. Conservador y sin estado. */
export function sanitize(input: unknown): string {
  let s = typeof input === "string" ? input : safeStringify(input);
  // IBAN (ES + 22) → deja país + 4 últimos.
  s = s.replace(/\b([A-Z]{2})\d{2}[ ]?(?:\d[ ]?){6,30}\b/g, (m) => {
    const digits = m.replace(/\s/g, "");
    return `${digits.slice(0, 2)}**…**${digits.slice(-4)}`;
  });
  // Secuencias largas de dígitos (posibles cuentas/tarjetas/OTP largos).
  s = s.replace(/\b\d{9,}\b/g, "«núm-redactado»");
  // Tokens tipo base64url largos (Bearer, cookies, JWT-ish).
  s = s.replace(/\b[A-Za-z0-9_-]{24,}\b/g, "«token-redactado»");
  s = s.replace(/(authorization|cookie|set-cookie|token|password|otp|clave|contrase[nñ]a)\s*[:=]\s*\S+/gi, "$1: «redactado»");
  // Emails → dominio conservado.
  s = s.replace(/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "$1***$2");
  return s;
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

export class Logger {
  constructor(private level: "info" | "debug" = "info") {}

  private write(tag: string, msg: string) {
    const line = `${new Date().toISOString()} [${tag}] ${sanitize(msg)}`;
    // Consola.
    if (tag === "ERROR") console.error(line);
    else console.log(line);
    // Fichero (best-effort).
    try {
      if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
      appendFileSync(resolve(LOG_DIR, `agent-${ymd(new Date())}.log`), line + "\n", "utf8");
    } catch {
      /* si no se puede escribir a disco, seguimos solo con consola */
    }
  }

  info(msg: string) { this.write("INFO", msg); }
  warn(msg: string) { this.write("WARN", msg); }
  error(msg: string) { this.write("ERROR", msg); }
  debug(msg: string) { if (this.level === "debug") this.write("DEBUG", msg); }
}
