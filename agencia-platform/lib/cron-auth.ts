/**
 * Autenticación unificada de los endpoints de cron.
 *
 * Acepta DOS tokens: INTERNAL_CRON_TOKEN (la convención estándar, la que usan
 * los workflows que funcionan, p.ej. sonia-briefing) y CRON_SECRET (legacy).
 * Motivo: los crons legacy fallaban en TODAS sus ejecuciones porque el
 * CRON_SECRET de GitHub Actions no coincide con el de Railway; aceptando
 * también INTERNAL_CRON_TOKEN (que sí está bien emparejado) los workflows
 * pueden migrar a ese token sin tocar la configuración de Railway.
 *
 * Formatos admitidos: `Authorization: Bearer <token>`, cabecera
 * `x-cron-secret: <token>` (la usan los crons de GMB) o `?secret=<token>`.
 */
export function cronAuthOk(req: Request): boolean {
  const accepted = [process.env.INTERNAL_CRON_TOKEN, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  const xCron = req.headers.get("x-cron-secret") ?? "";
  let qs = "";
  try {
    qs = new URL(req.url).searchParams.get("secret") ?? "";
  } catch {
    // URL inválida: seguimos solo con cabeceras
  }
  return accepted.some((s) => header === `Bearer ${s}` || xCron === s || (qs !== "" && qs === s));
}
