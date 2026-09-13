import { resolveMx } from "node:dns/promises";

export type EmailVerificationStatus = "deliverable" | "risky" | "domain_mx_valid" | "mx_missing" | "invalid" | "unknown";

const EMAIL_SYNTAX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeEmail(value: string | null | undefined): string | null {
  const email = String(value ?? "").trim().toLowerCase().replace(/^mailto:/, "").split(/[?#]/)[0];
  if (!email || email.length > 254 || !EMAIL_SYNTAX.test(email)) return null;
  return email;
}

/** Buzones publicados que no son apropiados para una conversación comercial. */
export function isEligibleOutreachEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (!email) return false;
  const local = email.split("@")[0];
  return !/^(?:no-?reply|do-?not-?reply|noreply|privacy|privacidad|legal|dpo|lopd|rgpd|gdpr|proteccion-?datos|data-?protection|compliance|abuse|postmaster|mailer-daemon)(?:$|[._+-])/i.test(local);
}

const INTERMEDIARY_DOMAINS = [
  "booksy.com", "booksy.es", "treatwell.com", "treatwell.es", "doctoralia.com", "doctoralia.es",
  "glovoapp.com", "just-eat.es", "ubereats.com", "tripadvisor.com", "paginasamarillas.es",
  "linktr.ee", "beacons.ai", "facebook.com", "instagram.com"
];

function isIntermediaryDomain(domain: string): boolean {
  return INTERMEDIARY_DOMAINS.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

const WEBMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.es", "outlook.com", "outlook.es",
  "live.com", "live.es", "yahoo.com", "yahoo.es", "icloud.com", "me.com", "proton.me",
  "protonmail.com", "telefonica.net", "movistar.es", "orange.es", "ono.com"
]);

/**
 * Permite buzones externos (p. ej. Gmail/Hotmail) solo cuando fueron hallados
 * navegando la web oficial ya validada. Sigue excluyendo webs/directorios y
 * dominios de email intermediarios.
 */
export function isAllowedWebsiteContactEmail(
  value: string,
  website: string | null | undefined,
  evidence?: { method?: "mailto" | "text" | null; pageKind?: "home" | "contact" | "other" | null }
): boolean {
  const email = normalizeEmail(value);
  if (!email || !isEligibleOutreachEmail(email) || !website) return false;
  try {
    const websiteDomain = new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, "");
    const emailDomain = email.split("@")[1];
    if (isIntermediaryDomain(websiteDomain) || isIntermediaryDomain(emailDomain)) return false;
    if (emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`) || websiteDomain.endsWith(`.${emailDomain}`)) return true;
    return WEBMAIL_DOMAINS.has(emailDomain) && (evidence?.method === "mailto" || evidence?.pageKind === "contact");
  } catch {
    return false;
  }
}

export function emailMatchesWebsiteDomain(value: string, website: string | null | undefined): boolean {
  const email = normalizeEmail(value);
  if (!email || !website) return false;
  try {
    const websiteDomain = new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, "");
    if (isIntermediaryDomain(websiteDomain)) return false;
    const emailDomain = email.split("@")[1];
    if (isIntermediaryDomain(emailDomain)) return false;
    return emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`) || websiteDomain.endsWith(`.${emailDomain}`);
  } catch {
    return false;
  }
}

/** Comprobación de dominio. No prueba que el buzón concreto exista. */
export async function verifyEmailAddress(value: string): Promise<EmailVerificationStatus> {
  const email = normalizeEmail(value);
  if (!email) return "invalid";
  const domain = email.split("@")[1];
  try {
    const records = await resolveMx(domain);
    return records.some((record) => record.exchange && record.exchange !== ".") ? "domain_mx_valid" : "mx_missing";
  } catch (error: any) {
    if (["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes(String(error?.code ?? ""))) return "mx_missing";
    return "unknown";
  }
}

export function hunterStatusToVerification(status: string, score: number | null): EmailVerificationStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "valid") return "deliverable";
  if (["invalid", "disposable"].includes(normalized)) return "invalid";
  // Accept-all no confirma que exista el buzón, incluso con score alto.
  if (["accept_all", "webmail"].includes(normalized)) return "risky";
  return score != null && score >= 95 ? "risky" : "unknown";
}

export function emailCandidateScore(email: string, website?: string | null): number {
  const [local, domain] = email.split("@");
  let score = 40;
  const role = /^(info|contacto|contact|hola|hello|ventas|sales|comercial|marketing|administracion|clientes|soporte)$/i;
  if (role.test(local)) score += 30;
  try {
    const websiteDomain = new URL(/^https?:/i.test(website ?? "") ? website! : `https://${website}`).hostname.replace(/^www\./, "");
    if (domain === websiteDomain || domain.endsWith(`.${websiteDomain}`)) score += 30;
  } catch {
    // A candidate can still be useful when Places returned an invalid website.
  }
  return Math.min(score, 100);
}
