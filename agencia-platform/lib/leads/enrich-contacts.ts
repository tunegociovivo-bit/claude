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

/** Busca decisores de una empresa por dominio (cargos senior). Best-effort. */
export async function apolloFindDecisionMakers(opts: { domain: string; apiKey: string; limit?: number }): Promise<ApolloPerson[]> {
  try {
    const resp = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": opts.apiKey },
      body: JSON.stringify({
        q_organization_domains: opts.domain,
        person_seniorities: ["owner", "founder", "c_suite", "partner", "vp", "head", "director"],
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
