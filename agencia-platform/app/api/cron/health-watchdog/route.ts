/**
 * Cron vigilante — detecta crons "mudos".
 *
 * Compara el último latido de cada cron (CronHeartbeat, que graba cronAuthOk)
 * con su cadencia esperada (CRON_CATALOG). Si alguno lleva sin ejecutarse más
 * de lo previsto, manda UN email de alerta (con cooldown de 6h para no spamear)
 * a OPS_ALERT_EMAIL. Así un fallo silencioso —como el del CRON_SECRET
 * desparejado que tuvo las tareas recurrentes muertas días— se detecta en
 * horas.
 *
 * Este cron usa su propia auth y workflow, de modo que aunque "todos" los
 * demás fallen, el vigilante sigue avisando.
 *
 * Auth: Bearer INTERNAL_CRON_TOKEN / CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { getCronsHealth } from "@/lib/cron-monitor";
import { sendEmail, isEmailEnabled } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const WATCHDOG_ROW = "_watchdog";

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const health = await getCronsHealth();
  const problems = health.filter((h) => h.status !== "ok");

  let alerted = false;
  if (problems.length > 0) {
    const wd = await prisma.cronHeartbeat.findUnique({ where: { name: WATCHDOG_ROW } });
    const coolingDown = wd?.alertedAt && wd.alertedAt.getTime() > Date.now() - ALERT_COOLDOWN_MS;
    const to = process.env.OPS_ALERT_EMAIL || process.env.ALERT_EMAIL;

    if (!coolingDown && to && isEmailEnabled()) {
      const rows = problems
        .map((p) => {
          const when =
            p.status === "never"
              ? "nunca se ha ejecutado"
              : `sin ejecutarse desde hace ${fmtMinutes(p.minutesSince!)} (máx ${fmtMinutes(p.maxStaleMin)})`;
          return `<li><b>${p.label}</b> (<code>${p.name}</code>): ${when}</li>`;
        })
        .join("");
      const text = problems
        .map((p) =>
          p.status === "never"
            ? `- ${p.label} (${p.name}): nunca se ha ejecutado`
            : `- ${p.label} (${p.name}): mudo desde hace ${fmtMinutes(p.minutesSince!)} (máx ${fmtMinutes(p.maxStaleMin)})`
        )
        .join("\n");
      await sendEmail({
        to,
        subject: `⚠️ Hub · ${problems.length} cron(s) sin ejecutarse`,
        html:
          `<p>El vigilante ha detectado crons que no se están ejecutando con su cadencia esperada:</p>` +
          `<ul>${rows}</ul>` +
          `<p>Revisa GitHub Actions y que los secretos (INTERNAL_CRON_TOKEN / CRON_SECRET) coincidan con Railway. ` +
          `Panel: /admin/estado</p>`,
        text
      }).catch((e) => console.error("[health-watchdog] email:", e?.message ?? e));
      await prisma.cronHeartbeat.upsert({
        where: { name: WATCHDOG_ROW },
        create: { name: WATCHDOG_ROW, lastRunAt: new Date(), alertedAt: new Date() },
        update: { alertedAt: new Date() }
      });
      alerted = true;
    }
  } else {
    // Todo sano: limpia el cooldown para que el próximo incidente avise ya.
    await prisma.cronHeartbeat
      .updateMany({ where: { name: WATCHDOG_ROW, alertedAt: { not: null } }, data: { alertedAt: null } })
      .catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    checked: health.length,
    problems: problems.map((p) => ({ name: p.name, status: p.status, minutesSince: p.minutesSince })),
    alerted
  });
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}
