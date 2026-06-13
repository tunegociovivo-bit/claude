/**
 * Kit para contactar al DIRECTIVO de una empresa por la vía profesional y
 * legal: a partir del nombre del cargo (del BORME / Registro Mercantil, dato
 * público) y el dominio de la empresa, propone correos corporativos probables,
 * un enlace de LinkedIn para localizar a la persona y un primer mensaje de
 * nivel ejecutivo. NO inventa móviles personales ni datos privados.
 */
import { complete, AIDisabledError } from "@/lib/ai/anthropic";
import { apolloFindDecisionMakers, hunterFindEmail, hunterVerifyEmail, type ApolloPerson, type EmailVerdict } from "./enrich-contacts";

export type Director = { role: string; name: string };

export type DecisionMakerKit = {
  domain: string | null;
  directors: Director[];
  emailGuesses: string[];
  /** Contactos encontrados por Apollo (nombre + cargo + LinkedIn + email). */
  found: ApolloPerson[];
  /** Emails verificados/encontrados por Hunter (estado + score). */
  verifiedEmails: EmailVerdict[];
  linkedinUrl: string;
  opener: string | null;
  disclaimer: string;
};

function asciiLower(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s-]/g, "")
    .trim();
}

/** Dominio limpio a partir de la web ("https://www.clinica.es/x" → "clinica.es"). */
function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(/^https?:/.test(website) ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * Patrones de correo corporativo probables. El BORME lista los nombres como
 * "APELLIDO1 APELLIDO2 NOMBRE", así que el nombre de pila suele ser el último
 * token y el primer apellido el primero.
 */
function emailGuesses(domain: string | null, director: Director | null): string[] {
  if (!domain) return [];
  const out = new Set<string>();
  // Buzones de rol (siempre útiles, no son datos personales).
  for (const box of ["info", "gerencia", "direccion", "administracion", "comercial"]) {
    out.add(`${box}@${domain}`);
  }
  if (director?.name) {
    const tokens = asciiLower(director.name).split(/[\s-]+/).filter(Boolean);
    if (tokens.length >= 2) {
      const given = tokens[tokens.length - 1];
      const surname = tokens[0];
      out.add(`${given}.${surname}@${domain}`);
      out.add(`${given[0]}${surname}@${domain}`);
      out.add(`${given}@${domain}`);
      out.add(`${given}${surname}@${domain}`);
    }
  }
  return Array.from(out).slice(0, 8);
}

const OPENER_SYSTEM = `Eres un consultor de marketing local (Negocio Vivo) que contacta al MÁXIMO
RESPONSABLE de una empresa (gerente/administrador/director) para ofrecerle captación de clientes,
reseñas y fidelización. Escribe un primer mensaje de nivel ejecutivo:
- Español de España, trato de usted, tono profesional pero cercano. Breve: 3-5 líneas.
- Personaliza con el nombre del directivo y el sector si los tienes. Aporta UN motivo concreto
  (oportunidad o problema típico de su sector) y propón un siguiente paso de bajo compromiso
  (una llamada de 10 min o enviar una propuesta). No inventes datos, cifras ni precios.
- Sirve tanto para email como para LinkedIn. Devuelve SOLO el texto, sin asunto ni firma.`;

export async function buildDecisionMakerKit(opts: {
  workspaceId: string;
  company: string;
  website?: string | null;
  province?: string | null;
  sector?: string | null;
  directors?: Director[];
  /** API keys opcionales para enriquecer/verificar el contacto. */
  apolloKey?: string | null;
  hunterKey?: string | null;
}): Promise<DecisionMakerKit> {
  const domain = domainFromWebsite(opts.website);
  const directors = (opts.directors ?? []).filter((d) => d?.name);
  const primary = directors[0] ?? null;

  // Apollo: encuentra al decisor real (nombre, cargo, LinkedIn, email) por
  // dominio. Si lo trae, manda sobre el patrón heurístico.
  let found: ApolloPerson[] = [];
  if (opts.apolloKey && domain) {
    found = await apolloFindDecisionMakers({ domain, apiKey: opts.apolloKey });
  }

  // Hunter: encuentra el email del directivo (BORME) y verifica candidatos.
  const verifiedEmails: EmailVerdict[] = [];
  if (opts.hunterKey && domain) {
    if (primary?.name) {
      const tokens = asciiLower(primary.name).split(/[\s-]+/).filter(Boolean);
      if (tokens.length >= 2) {
        const found1 = await hunterFindEmail({ domain, firstName: tokens[tokens.length - 1], lastName: tokens[0], apiKey: opts.hunterKey });
        if (found1) verifiedEmails.push(found1);
      }
    }
    // Verifica también el email que traiga Apollo (si lo hay) para dar confianza.
    const apolloEmail = found.find((p) => p.email)?.email;
    if (apolloEmail && !verifiedEmails.some((v) => v.email === apolloEmail)) {
      const v = await hunterVerifyEmail({ email: apolloEmail, apiKey: opts.hunterKey });
      if (v) verifiedEmails.push(v);
    }
  }

  const roleQuery = "gerente director administrador CEO propietario";
  const linkedinUrl =
    `https://www.linkedin.com/search/results/people/?keywords=` +
    encodeURIComponent(`${primary?.name ? primary.name + " " : ""}${opts.company} ${opts.province ?? ""}`.trim()) +
    (primary?.name ? "" : `&keywords=${encodeURIComponent(`${roleQuery} ${opts.company}`)}`);

  // Para el mensaje, el mejor contacto: Apollo (cargo real) > BORME.
  const bestName = found[0]?.name ?? primary?.name ?? null;
  const bestRole = found[0]?.title ?? primary?.role ?? null;

  let opener: string | null = null;
  try {
    const ctx = [
      `Empresa: ${opts.company}`,
      opts.sector ? `Sector: ${opts.sector}` : null,
      opts.province ? `Zona: ${opts.province}` : null,
      bestName ? `Directivo: ${bestRole ?? "Responsable"} — ${bestName}` : "Directivo: (desconocido, dirígete al máximo responsable)"
    ]
      .filter(Boolean)
      .join("\n");
    opener = (
      await complete({
        workspaceId: opts.workspaceId,
        model: "claude-haiku-4-5-20251001",
        system: OPENER_SYSTEM,
        user: `${ctx}\n\nEscribe el primer mensaje al directivo:`,
        maxTokens: 350,
        feature: "leads.decision_maker"
      })
    ).trim().replace(/^["']|["']$/g, "");
  } catch (e) {
    if (!(e instanceof AIDisabledError)) throw e;
  }

  return {
    domain,
    directors,
    emailGuesses: emailGuesses(domain, primary),
    found,
    verifiedEmails,
    linkedinUrl,
    opener,
    disclaimer:
      "Datos de cargos del BORME (Registro Mercantil, públicos). Los correos son PATRONES probables, no verificados: confírmalos antes de enviar y respeta el derecho de oposición (RGPD)."
  };
}
