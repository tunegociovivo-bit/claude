/**
 * Cliente mínimo de Twilio Verify (REST, sin SDK) para OTP por SMS.
 *
 * Env requeridas (se configuran en Railway, NO en el código):
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - TWILIO_VERIFY_SERVICE_SID   (SID del Verify Service, empieza por VA…)
 *
 * Si faltan, las funciones devuelven { configured: false } para que la UI
 * muestre un aviso claro en vez de romperse.
 */

const BASE = "https://verify.twilio.com/v2";

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !service) return null;
  return { sid, token, service, auth: Buffer.from(`${sid}:${token}`).toString("base64") };
}

export function twilioConfigured(): boolean {
  return !!creds();
}

/**
 * Cuenta de REVISIÓN (App Store / Play). Permite a los revisores iniciar sesión
 * sin recibir un SMS real: un teléfono + código fijos configurados por env (NO
 * en el código) que se entregan a la tienda en "Información para el equipo de
 * revisión".
 *
 *   BUBUI_REVIEW_PHONE  (p. ej. +34600000000)
 *   BUBUI_REVIEW_CODE   (p. ej. "424242")
 *
 * Si no están definidas, el bypass queda desactivado (comportamiento normal).
 */
function reviewCreds(): { phone: string; code: string } | null {
  const phone = process.env.BUBUI_REVIEW_PHONE;
  const code = process.env.BUBUI_REVIEW_CODE;
  if (!phone || !code) return null;
  return { phone: toE164(phone) ?? phone, code };
}

/** ¿Es el teléfono de la cuenta de revisión? (recibe E.164 ya normalizado) */
export function isReviewPhone(phoneE164: string): boolean {
  const r = reviewCreds();
  return !!r && r.phone === phoneE164;
}

/**
 * Normaliza un teléfono a E.164. Por defecto España (+34).
 * Acepta: +34600111222 · 0034600111222 · 600 11 12 22 · 600111222.
 */
export function toE164(raw: string, defaultCountry = "34"): string | null {
  let s = (raw || "").replace(/[\s().-]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) return /^\+\d{8,15}$/.test(s) ? s : null;
  if (s.startsWith("00")) s = s.slice(2);
  // Si ya trae prefijo país (ej. 34XXXXXXXXX) y longitud razonable.
  if (s.length > 9 && s.startsWith(defaultCountry)) return `+${s}`;
  // Número nacional (9 dígitos en España).
  if (/^\d{9}$/.test(s)) return `+${defaultCountry}${s}`;
  if (/^\d{8,15}$/.test(s)) return `+${s}`;
  return null;
}

type StartResult =
  | { configured: false }
  | { configured: true; ok: true }
  | { configured: true; ok: false; error: string };

export async function startVerification(phoneE164: string): Promise<StartResult> {
  // Cuenta de revisión: no enviamos SMS, simulamos envío correcto.
  if (isReviewPhone(phoneE164)) return { configured: true, ok: true };
  const c = creds();
  if (!c) return { configured: false };
  const body = new URLSearchParams({ To: phoneE164, Channel: "sms" });
  const r = await fetch(`${BASE}/Services/${c.service}/Verifications`, {
    method: "POST",
    headers: { Authorization: `Basic ${c.auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return { configured: true, ok: false, error: j?.message ?? `Twilio ${r.status}` };
  }
  return { configured: true, ok: true };
}

type CheckResult =
  | { configured: false }
  | { configured: true; approved: boolean; error?: string };

export async function checkVerification(phoneE164: string, code: string): Promise<CheckResult> {
  // Cuenta de revisión: aprobamos solo con el código fijo configurado.
  const rev = reviewCreds();
  if (rev && rev.phone === phoneE164) return { configured: true, approved: code === rev.code };
  const c = creds();
  if (!c) return { configured: false };
  const body = new URLSearchParams({ To: phoneE164, Code: code });
  const r = await fetch(`${BASE}/Services/${c.service}/VerificationCheck`, {
    method: "POST",
    headers: { Authorization: `Basic ${c.auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { configured: true, approved: false, error: j?.message ?? `Twilio ${r.status}` };
  }
  return { configured: true, approved: j?.status === "approved" };
}
