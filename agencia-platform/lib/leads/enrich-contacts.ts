/**
 * Enriquecimiento de contacto de directivos con servicios externos (opcionales):
 *  - Apollo: encuentra al decisor (nombre, cargo, LinkedIn, email) por dominio.
 *  - Hunter: encuentra el email más probable por dominio+nombre y VERIFICA un
 *    email (válido / arriesgado / inválido) antes de enviar.
 *
 * Ambos van gated por API key (env o Ajustes del workspace). Si no hay key o
 * la llamada falla, se devuelve vacío y el kit cae a los patrones heurísticos.
 */

export type ApolloPerson = { name: string; title: string | null; linkedin: string | null; email: string | null };
export type EmailVerdict = { email: string; status: string; score: number | null };

/** Busca decisores de una empresa por dominio (cargos senior). Best-effort.
 *  `titles` acota por cargo (p.ej. marketing/expansión) — Apollo los trata como OR. */
export async function apolloFindDecisionMakers(opts: { domain: string; apiKey: string; limit?: number; titles?: string[] }): Promise<ApolloPerson[]> {
  try {
    const resp = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": opts.apiKey },
      body: JSON.stringify({
        q_organization_domains: opts.domain,
        person_seniorities: ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager"],
        ...(opts.titles && opts.titles.length ? { person_titles: opts.titles } : {}),
        page: 1,
        per_page: Math.min(opts.limit ?? 5, 10)
      }),
      signal: AbortSignal.timeout(15000)
    });
    const data: any = await resp.json().catch(() => null);
    if (!resp.ok) return [];
    const people: any[] = Array.isArray(data?.people) ? data.people : [];
    return people
      .map((p) => ({
        name: [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || String(p?.name ?? "").trim(),
        title: p?.title ?? null,
        linkedin: p?.linkedin_url ?? null,
        // Apollo solo revela el email si tu plan tiene créditos; si no, viene
        // como "email_not_unlocked@domain.com" → lo descartamos.
        email: typeof p?.email === "string" && !/email_not_unlocked/i.test(p.email) ? p.email : null
      }))
      .filter((p) => p.name);
  } catch {
    return [];
  }
}

export type HunterPerson = { name: string; position: string | null; email: string; department: string | null; confidence: number | null };

/** Busca personas de un dominio (opcionalmente de un DEPARTAMENTO, p.ej.
 *  "marketing") con su email real, vía Hunter Domain Search. Best-effort. */
export async function hunterDomainSearch(opts: { domain: string; apiKey: string; department?: string; limit?: number }): Promise<HunterPerson[]> {
  try {
    const dep = opts.department ? `&department=${encodeURIComponent(opts.department)}` : "";
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(opts.domain)}${dep}&limit=${opts.limit ?? 10}&api_key=${encodeURIComponent(opts.apiKey)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data: any = await resp.json().catch(() => null);
    if (!resp.ok) return [];
    const emails: any[] = Array.isArray(data?.data?.emails) ? data.data.emails : [];
    return emails
      .filter((e) => e?.value)
      .map((e) => ({
        name: [e.first_name, e.last_name].filter(Boolean).join(" ").trim(),
        position: e.position ?? null,
        email: e.value as string,
        department: e.department ?? null,
        confidence: typeof e.confidence === "number" ? e.confidence : null
      }));
  } catch {
    return [];
  }
}

/** Resuelve las API keys de Apollo/Hunter (env o Ajustes cifrados del workspace). */
export async function resolveContactKeys(workspaceId: string): Promise<{ apolloKey: string | null; hunterKey: string | null }> {
  const { prisma } = await import("@/lib/db/prisma");
  const { decryptSecret } = await import("@/lib/ai/crypto");
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const s: any = (ws?.settings as any)?.leads ?? {};
  const apolloKey = process.env.APOLLO_API_KEY || (s.apolloApiKeyEnc ? decryptSecret(s.apolloApiKeyEnc) : null);
  const hunterKey = process.env.HUNTER_API_KEY || (s.hunterApiKeyEnc ? decryptSecret(s.hunterApiKeyEnc) : null);
  return { apolloKey: apolloKey || null, hunterKey: hunterKey || null };
}

/** Email más probable (dominio + nombre + apellido) vía Hunter, con score. */
export async function hunterFindEmail(opts: { domain: string; firstName: string; lastName: string; apiKey: string }): Promise<EmailVerdict | null> {
  try {
    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(opts.domain)}&first_name=${encodeURIComponent(opts.firstName)}&last_name=${encodeURIComponent(opts.lastName)}&api_key=${encodeURIComponent(opts.apiKey)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data: any = await resp.json().catch(() => null);
    if (!resp.ok || !data?.data?.email) return null;
    return { email: data.data.email, status: data.data.verification?.status ?? "unknown", score: data.data.score ?? null };
  } catch {
    return null;
  }
}

// Cargos de marketing/comunicación/crecimiento para localizar al DECISOR.
const MARKETING_TITLES = [
  "marketing", "chief marketing officer", "cmo", "marketing director", "director de marketing",
  "responsable de marketing", "head of marketing", "marketing manager", "brand", "brand manager",
  "comunicación", "communications", "digital marketing", "growth"
];

export type ContactHit = { email: string | null; name: string | null; role: string | null; linkedin: string | null; via: string | null };

/**
 * Localiza el mejor email de contacto de una empresa por su DOMINIO, priorizando
 * al responsable de MARKETING. Combina varias vías (Hunter dept. marketing →
 * Apollo decisores → Hunter cualquier dept. → email-finder por nombre). Cada vía
 * es best-effort; si no hay keys o no encuentra, devuelve nulos.
 */
export async function findMarketingContactByDomain(workspaceId: string, domain: string): Promise<ContactHit> {
  const out: ContactHit = { email: null, name: null, role: null, linkedin: null, via: null };
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
  if (!clean) return out;
  const { apolloKey, hunterKey } = await resolveContactKeys(workspaceId);
  if (!apolloKey && !hunterKey) return out;

  // 1) Hunter: departamento marketing primero, luego cualquier departamento.
  if (hunterKey) {
    try {
      let people = await hunterDomainSearch({ domain: clean, apiKey: hunterKey, department: "marketing", limit: 10 });
      let best = people.filter((p) => p.email).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      if (!best) {
        people = await hunterDomainSearch({ domain: clean, apiKey: hunterKey, limit: 10 });
        best = people.filter((p) => p.email).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      }
      if (best) { out.email = best.email; out.name = best.name || null; out.role = best.position || null; out.via = "hunter"; }
    } catch {}
  }
  // 2) Apollo: decisor de marketing (nombre, cargo, LinkedIn; a veces email).
  if (apolloKey) {
    try {
      const people = await apolloFindDecisionMakers({ domain: clean, apiKey: apolloKey, titles: MARKETING_TITLES, limit: 5 });
      const p = people[0];
      if (p) {
        out.linkedin = out.linkedin ?? p.linkedin;
        out.name = out.name ?? p.name;
        out.role = out.role ?? p.title;
        if (!out.email && p.email) { out.email = p.email; out.via = "apollo"; }
      }
    } catch {}
  }
  // 3) Nombre sin email → email-finder de Hunter (patrón del dominio verificado).
  if (!out.email && out.name && hunterKey) {
    try {
      const tokens = out.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s-]+/).filter(Boolean);
      if (tokens.length >= 2) {
        const v = await hunterFindEmail({ domain: clean, firstName: tokens[0], lastName: tokens[tokens.length - 1], apiKey: hunterKey });
        if (v) { out.email = v.email; out.via = "hunter_finder"; }
      }
    } catch {}
  }
  return out;
}

export type MarketingEmail = { email: string; name: string | null; role: string | null };

/**
 * Recopila VARIOS emails de directivos de marketing de una empresa por su dominio
 * (Hunter dept. marketing + Apollo decisores con email), deduplicados y ordenados
 * por relevancia. Para poner a todos en copia oculta y asegurar que llega a la
 * persona correcta. Best-effort; devuelve [] si no hay keys o resultados.
 */
export async function findMarketingEmailsByDomain(workspaceId: string, domain: string, max = 10): Promise<MarketingEmail[]> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
  if (!clean) return [];
  const { apolloKey, hunterKey } = await resolveContactKeys(workspaceId);
  if (!apolloKey && !hunterKey) return [];
  const byEmail = new Map<string, MarketingEmail>();

  if (hunterKey) {
    try {
      const people = await hunterDomainSearch({ domain: clean, apiKey: hunterKey, department: "marketing", limit: 20 });
      for (const p of people.filter((x) => x.email).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))) {
        const k = p.email.toLowerCase();
        if (!byEmail.has(k)) byEmail.set(k, { email: p.email, name: p.name || null, role: p.position || null });
      }
    } catch {}
  }
  if (apolloKey) {
    try {
      const people = await apolloFindDecisionMakers({ domain: clean, apiKey: apolloKey, titles: MARKETING_TITLES, limit: 15 });
      for (const p of people) {
        if (!p.email) continue;
        const k = p.email.toLowerCase();
        if (!byEmail.has(k)) byEmail.set(k, { email: p.email, name: p.name || null, role: p.title || null });
      }
    } catch {}
  }
  return [...byEmail.values()].slice(0, max);
}

/** Verifica si un email existe / es entregable. Devuelve estado + score. */
export async function hunterVerifyEmail(opts: { email: string; apiKey: string }): Promise<EmailVerdict | null> {
  try {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(opts.email)}&api_key=${encodeURIComponent(opts.apiKey)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data: any = await resp.json().catch(() => null);
    if (!resp.ok || !data?.data) return null;
    return { email: opts.email, status: data.data.status ?? "unknown", score: data.data.score ?? null };
  } catch {
    return null;
  }
}
