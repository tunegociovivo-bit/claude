/**
 * FASE 2 — enriquecimiento de CONTACTO profesional del titular de franquicia.
 *
 * Tras identificar la sociedad operadora / CIF / administrador (fase 1), aquí buscamos un canal
 * ACCIONABLE NUEVO: email profesional verificado o móvil profesional PUBLICADO del operador/
 * administrador/responsable local. Reglas duras:
 *   - Solo datos profesionales PUBLICADOS (web oficial/local, Hunter, Apollo). Nada privado.
 *   - NO se inventan patrones de email: un email solo cuenta si está publicado en la web oficial
 *     o si un proveedor lo devuelve y se VERIFICA como entregable.
 *   - El fijo que ya tenía Google Places NO cuenta como canal nuevo; solo MÓVILES publicados.
 *   - Se guarda procedencia (source/url), fecha, tipo, persona/cargo y confianza; se deduplica.
 *   - NO sobrescribe teléfono/email existente salvo mayor confianza (eso lo decide el llamante).
 *
 * Todo best-effort y acotado en coste/tiempo. Los proveedores ya capturan sus errores y devuelven
 * vacío; si NO hay ningún medio (ni web ni claves), el estado es `provider_error` (visible).
 */
import { resolveContactKeys, hunterCompanySearch, hunterDomainSearch, apolloFindDecisionMakers, hunterFindEmail, hunterVerifyEmail } from "./enrich-contacts";
import { extractContactsFromWebsite, normalizeEsPhone } from "./email-extract";

export type ContactStatus = "actionable_contact" | "identified_no_contact" | "unconfirmed" | "provider_error";
export type ContactConfidence = "high" | "medium" | "low";
export type ContactChannel = {
  type: "email" | "mobile";
  value: string;
  person: string | null;
  role: string | null;
  source: string; // web_oficial | hunter | apollo | hunter_finder
  sourceUrl: string | null;
  foundAt: string;
  confidence: ContactConfidence;
  verified: { status: string; score: number | null } | null;
};
export type ContactResult = {
  status: ContactStatus;
  channels: ContactChannel[];
  providersTried: string[];
  explanation: string;
  researchedAt: string;
};

/** Fallo inesperado (no el vacío best-effort de los proveedores). Se propaga para reintento. */
export class ContactProviderError extends Error {
  constructor(message: string) { super(message); this.name = "ContactProviderError"; }
}

const domainOf = (website?: string | null): string | null => {
  if (!website) return null;
  try { return new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "").toLowerCase() || null; } catch { return null; }
};
const nameTokens = (name?: string | null): string[] =>
  (name ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s,.-]+/).filter((t) => t.length > 1);

/** Verificación de Hunter que consideramos "entregable" (email accionable). */
const isDeliverable = (status?: string | null) => ["valid", "deliverable", "accept_all"].includes(String(status ?? "").toLowerCase());

export async function researchFranchiseContact(opts: {
  workspaceId: string;
  operatorName: string | null;
  taxId?: string | null;
  adminName?: string | null; // administrador/responsable (ownerName de fase 1)
  operatorWebsite?: string | null; // web LOCAL del operador (no la central)
  existingPhone?: string | null; // fijo de Google Places → NO cuenta como nuevo
  existingEmail?: string | null; // email ya presente en el lead
  now?: Date;
}): Promise<ContactResult> {
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  // Sin titular confirmado no tiene sentido buscar su contacto profesional.
  if (!opts.operatorName) {
    return { status: "unconfirmed", channels: [], providersTried: [], explanation: "Sin sociedad operadora confirmada; no se busca contacto.", researchedAt: iso };
  }

  const { apolloKey, hunterKey } = await resolveContactKeys(opts.workspaceId);
  const siteDomain = domainOf(opts.operatorWebsite);
  const providersTried: string[] = [];
  const existingEmail = (opts.existingEmail ?? "").trim().toLowerCase() || null;
  const existingMobile = normalizeEsPhone(opts.existingPhone); // solo excluye si el fijo fuese móvil
  const channels: ContactChannel[] = [];
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  const pushEmail = (value: string, person: string | null, role: string | null, source: string, sourceUrl: string | null, confidence: ContactConfidence, verified: ContactChannel["verified"]) => {
    const v = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
    if (seenEmail.has(v)) return;
    seenEmail.add(v);
    channels.push({ type: "email", value: v, person, role, source, sourceUrl, foundAt: iso, confidence, verified });
  };
  const pushMobile = (value: string, person: string | null, role: string | null, source: string, sourceUrl: string | null, confidence: ContactConfidence) => {
    const v = normalizeEsPhone(value);
    if (!v) return;
    if (seenPhone.has(v)) return;
    seenPhone.add(v);
    channels.push({ type: "mobile", value: v, person, role, source, sourceUrl, foundAt: iso, confidence, verified: null });
  };

  try {
    // 1) WEB OFICIAL/LOCAL: emails + móviles PUBLICADOS (lo más fiable y sin coste de API).
    if (opts.operatorWebsite) {
      providersTried.push("web_oficial");
      const { emails, mobiles } = await extractContactsFromWebsite(opts.operatorWebsite);
      for (const e of emails) pushEmail(e, opts.adminName ?? null, null, "web_oficial", opts.operatorWebsite, "high", null);
      for (const m of mobiles) pushMobile(m, opts.adminName ?? null, null, "web_oficial", opts.operatorWebsite, "high");
    }

    // 2) HUNTER por RAZÓN SOCIAL (resuelve el dominio corporativo real) y por dominio conocido.
    let resolvedDomain = siteDomain;
    if (hunterKey) {
      providersTried.push("hunter");
      const cs = await hunterCompanySearch({ company: opts.operatorName, apiKey: hunterKey, limit: 15 });
      if (cs.domain) resolvedDomain = resolvedDomain ?? cs.domain;
      for (const p of cs.people.filter((x) => x.email).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))) {
        pushEmail(p.email, p.name || null, p.position || null, "hunter", null, (p.confidence ?? 0) >= 80 ? "high" : (p.confidence ?? 0) >= 50 ? "medium" : "low", null);
      }
      if (resolvedDomain) {
        for (const p of (await hunterDomainSearch({ domain: resolvedDomain, apiKey: hunterKey, limit: 15 })).filter((x) => x.email).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))) {
          pushEmail(p.email, p.name || null, p.position || null, "hunter", null, (p.confidence ?? 0) >= 80 ? "high" : (p.confidence ?? 0) >= 50 ? "medium" : "low", null);
        }
      }
    }

    // 3) APOLLO por dominio: decisor real (a veces con email desbloqueado).
    if (apolloKey && resolvedDomain) {
      providersTried.push("apollo");
      for (const p of await apolloFindDecisionMakers({ domain: resolvedDomain, apiKey: apolloKey, limit: 5 })) {
        if (p.email) pushEmail(p.email, p.name || null, p.title || null, "apollo", p.linkedin ?? null, "medium", null);
      }
    }

    // 4) EMAIL-FINDER por ADMINISTRADOR + dominio (proveedor-derivado; solo cuenta si VERIFICA).
    if (hunterKey && resolvedDomain && opts.adminName) {
      const t = nameTokens(opts.adminName);
      if (t.length >= 2) {
        providersTried.push("hunter_finder");
        const v = await hunterFindEmail({ domain: resolvedDomain, firstName: t[0], lastName: t[t.length - 1], apiKey: hunterKey });
        if (v?.email && isDeliverable(v.status)) pushEmail(v.email, opts.adminName, null, "hunter_finder", null, "medium", { status: v.status, score: v.score });
      }
    }

    // 5) VERIFICAR emails no publicados en web (Hunter) para elevar a accionable.
    if (hunterKey) {
      for (const ch of channels) {
        if (ch.type !== "email" || ch.verified || ch.source === "web_oficial") continue;
        const v = await hunterVerifyEmail({ email: ch.value, apiKey: hunterKey });
        if (v) ch.verified = { status: v.status, score: v.score };
      }
    }
  } catch (e: any) {
    // Fallo REALMENTE inesperado (los proveedores ya capturan lo suyo) → visible + reintentable.
    throw new ContactProviderError(String(e?.message ?? e).slice(0, 200));
  }

  // Sin ningún medio para buscar (ni web local ni claves) → provider_error (config incompleta).
  if (!opts.operatorWebsite && !apolloKey && !hunterKey) {
    return { status: "provider_error", channels: [], providersTried, explanation: "Sin web local ni integraciones (Hunter/Apollo) configuradas para buscar contacto.", researchedAt: iso };
  }

  // ¿Es un canal ACCIONABLE NUEVO? email publicado en web oficial o verificado entregable; móvil
  // publicado. Y NO puede coincidir con el email/fijo que ya tenía el lead.
  const isActionable = (ch: ContactChannel): boolean => {
    if (ch.type === "email") {
      if (existingEmail && ch.value === existingEmail) return false; // ya lo tenía
      return ch.source === "web_oficial" || (!!ch.verified && isDeliverable(ch.verified.status));
    }
    // móvil publicado y distinto del que ya constaba
    return !existingMobile || ch.value !== existingMobile;
  };
  const actionable = channels.filter(isActionable);
  // Orden: accionables primero, luego por confianza.
  const rank = (c: ContactChannel) => (isActionable(c) ? 0 : 1) * 10 + (c.confidence === "high" ? 0 : c.confidence === "medium" ? 1 : 2);
  channels.sort((a, b) => rank(a) - rank(b));

  if (actionable.length > 0) {
    const kinds = [...new Set(actionable.map((c) => c.type))].map((k) => (k === "email" ? "email" : "móvil")).join(" y ");
    return { status: "actionable_contact", channels: channels.slice(0, 12), providersTried, explanation: `Encontrado ${actionable.length} canal(es) accionable(s) (${kinds}).`, researchedAt: iso };
  }
  return { status: "identified_no_contact", channels: channels.slice(0, 12), providersTried, explanation: channels.length ? "Se hallaron datos pero ninguno accionable/nuevo verificado." : "No se encontró contacto profesional publicado nuevo.", researchedAt: iso };
}
