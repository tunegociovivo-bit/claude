/**
 * Resuelve la URL base PÚBLICA del Hub a partir de una request entrante.
 *
 * Por qué: detrás del proxy de Railway, `new URL(req.url).origin` devuelve el
 * host INTERNO del contenedor (p.ej. http://28033db38d3b:8080), inútil para
 * webhooks de terceros (WAHA/Evolution) que deben llamar al dominio público.
 *
 * Orden de preferencia:
 *   1) override explícito (settings.leads.publicBaseUrl),
 *   2) cabeceras del proxy (x-forwarded-host/proto o host),
 *   3) env público (NEXT_PUBLIC_APP_URL / NEXTAUTH_URL),
 *   4) origin de la request (último recurso).
 * Si el host resuelto parece interno (sin punto, o IP/host de Docker), se
 * salta al env público.
 */
export function publicBaseUrl(req: Request, override?: string | null): string {
  if (override && /^https?:\/\//i.test(override)) return override.replace(/\/+$/, "");

  const h = req.headers;
  const fwdHost = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = fwdHost || h.get("host")?.trim() || "";
  const proto = (h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https").replace(/[^a-z]/g, "");

  const looksInternal = (host: string) =>
    !host ||
    !host.includes(".") || // contenedores Docker: host sin dominio (28033db38d3b)
    /^localhost(:|$)/i.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}(:|$)/.test(host); // IP cruda

  if (host && !looksInternal(host)) return `${proto}://${host}`.replace(/\/+$/, "");

  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, "");

  try {
    return new URL(req.url).origin.replace(/\/+$/, "");
  } catch {
    return "https://hub.negociovivo.app";
  }
}
