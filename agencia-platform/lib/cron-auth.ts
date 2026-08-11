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
 * Formatos admitidos: `Authorization: Bearer <token>` y cabecera
 * `x-cron-secret: <token>` (la usan los crons de GMB). El comparador es de
 * TIEMPO CONSTANTE (timingSafeEqual) para no filtrar el token por timing.
 *
 * FASE 1 · Punto 7 — secreto en la URL DESACTIVADO por defecto: `?secret=<token>`
 * viaja en logs de proxy, historial y referrers. Se mantiene SOLO si se activa
 * explícitamente `CRON_ALLOW_QUERY_SECRET="true"` (transición para crons legacy
 * que aún no migraron a cabecera); cada uso emite un aviso de deprecación.
 *
 * Efecto secundario: en cada hit autenticado graba el "latido" del cron
 * (CronHeartbeat) para que el watchdog detecte crons mudos. Es fire-and-forget
 * y nunca bloquea ni rompe el cron.
 */
import { timingSafeEqual } from "crypto";

/** Igualdad en tiempo constante, robusta ante longitudes distintas. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Comparación ficticia de longitud igual para no filtrar la longitud por timing.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** ¿Alguno de los tokens aceptados coincide (en tiempo constante) con `candidate`? */
function matchesAccepted(accepted: string[], candidate: string): boolean {
  if (!candidate) return false;
  let ok = false;
  // Recorre TODOS (sin short-circuit) para no filtrar por timing cuál coincidió.
  for (const s of accepted) if (safeEqual(candidate, s)) ok = true;
  return ok;
}

export function cronAuthOk(req: Request): boolean {
  const accepted = [process.env.INTERNAL_CRON_TOKEN, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const xCron = req.headers.get("x-cron-secret") ?? "";
  let pathname = "";
  let qs = "";
  try {
    const url = new URL(req.url);
    pathname = url.pathname;
    qs = url.searchParams.get("secret") ?? "";
  } catch {
    // URL inválida: seguimos solo con cabeceras
  }

  let ok = matchesAccepted(accepted, bearer) || matchesAccepted(accepted, xCron);

  // Vía legacy por query string: SOLO si se habilita explícitamente.
  if (!ok && qs && process.env.CRON_ALLOW_QUERY_SECRET === "true") {
    if (matchesAccepted(accepted, qs)) {
      ok = true;
      console.warn(
        `[cron-auth] DEPRECADO: secreto recibido por ?secret= en ${pathname || "?"}. Migra a la cabecera 'Authorization: Bearer' o 'x-cron-secret'; esta vía se retirará.`
      );
    }
  }

  if (ok && pathname) {
    void import("./cron-monitor")
      .then((m) => {
        const name = m.cronNameFromPath(pathname);
        if (name && m.CRON_CATALOG[name]) return m.recordCronRun(name);
      })
      .catch(() => {});
  }
  return ok;
}
