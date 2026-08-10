/**
 * Runner de cron para Railway (alternativa a GitHub Actions).
 *
 * Pensado para un servicio cron de Railway que se ejecute CADA ~10 min
 * (Cron Schedule: "(asterisk)/10 * * * *"). En cada ejecución:
 *
 *   - Llama SIEMPRE a /api/v1/internal/reminders (avisos de tareas que
 *     vencen + recordatorios push de eventos próximos).
 *   - Solo en la franja matinal (BRIEFING_HOUR_UTC, por defecto 6 UTC ≈
 *     08:00 hora peninsular) llama a /api/cron/sonia-briefing. La
 *     idempotencia del endpoint garantiza un único briefing al día aunque
 *     se invoque varias veces dentro de esa hora.
 *
 * Variables de entorno necesarias (configúralas en el servicio cron de
 * Railway):
 *   HUB_BASE_URL          (def. https://hub.negociovivo.app)
 *   INTERNAL_CRON_TOKEN   (para /api/v1/internal/reminders)
 *   CRON_SECRET           (para /api/cron/sonia-briefing)
 *   BRIEFING_HOUR_UTC     (opcional, def. 6)
 *
 * Cómo montarlo en Railway:
 *   1. Crea un servicio nuevo desde este mismo repo.
 *   2. Start command:  npm run cron:tick
 *   3. Settings → Cron Schedule:  (asterisk)/10 * * * *
 *   4. Añade las env vars de arriba (mismos valores que el servicio web).
 */

const BASE = (process.env.HUB_BASE_URL ?? "https://hub.negociovivo.app").replace(/\/+$/, "");
const INTERNAL = process.env.INTERNAL_CRON_TOKEN ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const BRIEFING_HOUR = parseInt(process.env.BRIEFING_HOUR_UTC ?? "6", 10);

async function hit(method: "GET" | "POST", path: string, auth: string): Promise<void> {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000)
    });
    const body = await r.text().catch(() => "");
    console.log(`[cron-tick] ${method} ${path} → ${r.status} ${body.slice(0, 200)}`);
    if (!r.ok) process.exitCode = 1;
  } catch (e: any) {
    console.error(`[cron-tick] ${method} ${path} ERROR: ${e?.message ?? e}`);
    process.exitCode = 1;
  }
}

async function main() {
  if (INTERNAL) await hit("POST", "/api/v1/internal/reminders", INTERNAL);
  else console.warn("[cron-tick] INTERNAL_CRON_TOKEN no definido — salto recordatorios");

  if (new Date().getUTCHours() === BRIEFING_HOUR) {
    if (CRON_SECRET) await hit("GET", "/api/cron/sonia-briefing", CRON_SECRET);
    else console.warn("[cron-tick] CRON_SECRET no definido — salto briefing");
  }

  // Monitorización continua de leads. El endpoint trae un guard interno
  // (solo revisa búsquedas vencidas cada ~6 h), así que es seguro llamarlo
  // en cada tick.
  if (CRON_SECRET) await hit("GET", "/api/cron/leads-monitor", CRON_SECRET);
  if (CRON_SECRET || INTERNAL) await hit("GET", "/api/cron/invoice-reminders", CRON_SECRET || INTERNAL);
}

main();
