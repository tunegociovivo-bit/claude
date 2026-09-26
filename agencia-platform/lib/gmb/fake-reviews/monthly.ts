/**
 * Informe mensual del escudo de reputación: se genera el día 1 para cada vigilancia con el informe
 * activado y se envía por email en PDF. También se puede descargar a demanda para cualquier mes.
 */
import { prisma } from "@/lib/db/prisma";
import type { Place } from "./core";
import { placeKeyOf } from "./network";
import { getLearningStats } from "./shield";
import type { WatchHistoryEntry } from "./watch-logic";
import type { LearningStats } from "./cases-logic";

export type MonthlyData = {
  month: string;
  label: string;
  name: string;
  place: Place;
  rating: { start: number | null; end: number | null };
  reviews: { start: number | null; end: number | null };
  newReviews: number;
  newNeg: number;
  flagged: number;
  alerts: { attack: number; suspicious: number; known: number; competitor: number };
  cases: { created: number; reported: number; removed: number; open: number };
  removed: { author: string; rating: number; date: string; option: string; target: string; place: string }[];
  open: { author: string; rating: number; date: string; status: string; option: string; target: string; place: string }[];
  competitors: string[];
  learning: LearningStats | null;
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)), label: `${MONTHS[m - 1]} ${y}` };
}

export const previousMonth = (d = new Date()) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return x.toISOString().slice(0, 7);
};

export async function monthlyData(workspaceId: string, watchId: string, month: string): Promise<MonthlyData | null> {
  const w = await prisma.gmbReviewWatch.findFirst({ where: { id: watchId, workspaceId } });
  if (!w) return null;
  const place = w.place as unknown as Place;
  const comps = ((w.competitors as unknown as Place[] | null) ?? []);
  const { from, to, label } = monthRange(month);
  const hist = ((w.history as unknown as WatchHistoryEntry[] | null) ?? []).filter((h) => h.d >= from.toISOString().slice(0, 10) && h.d < to.toISOString().slice(0, 10));
  const placeKey = placeKeyOf(place.dataId || place.placeId, place.title);
  const compKeys = comps.map((c) => placeKeyOf(c.dataId || c.placeId, c.title));
  const scope = { workspaceId, OR: [{ watchId: w.id }, { placeKey: { in: [placeKey, ...compKeys] } }] };
  const [created, reported, removedRows, openRows, alerts] = await Promise.all([
    prisma.gmbReviewCase.count({ where: { ...scope, createdAt: { gte: from, lt: to } } }),
    prisma.gmbReviewCase.count({ where: { ...scope, reportedAt: { gte: from, lt: to } } }),
    prisma.gmbReviewCase.findMany({ where: { ...scope, removedAt: { gte: from, lt: to } }, take: 50, orderBy: { removedAt: "desc" } }),
    prisma.gmbReviewCase.findMany({ where: { ...scope, status: { notIn: ["retirada", "descartada"] } }, take: 25, orderBy: { score: "desc" } }),
    prisma.gmbAlert.findMany({ where: { workspaceId, createdAt: { gte: from, lt: to }, dedupKey: { contains: w.id } }, select: { type: true } })
  ]);
  const count = (t: string) => alerts.filter((a) => a.type === t).length;
  return {
    month,
    label,
    name: w.name,
    place,
    rating: { start: hist[0]?.rating ?? null, end: hist[hist.length - 1]?.rating ?? null },
    reviews: { start: hist[0]?.reviews ?? null, end: hist[hist.length - 1]?.reviews ?? null },
    newReviews: hist.reduce((s, h) => s + h.newReviews, 0),
    newNeg: hist.reduce((s, h) => s + h.newNeg, 0),
    flagged: hist.reduce((s, h) => s + h.flagged, 0),
    alerts: { attack: count("review_attack"), suspicious: count("suspicious_review"), known: count("known_profile"), competitor: count("competitor_spike") },
    cases: { created, reported, removed: removedRows.length, open: openRows.length },
    removed: removedRows.map((c) => ({ author: c.author, rating: c.rating, date: c.reviewDate, option: c.googleOption, target: c.target, place: c.placeTitle })),
    open: openRows.map((c) => ({ author: c.author, rating: c.rating, date: c.reviewDate, status: c.status, option: c.googleOption, target: c.target, place: c.placeTitle })),
    competitors: comps.map((c) => c.title),
    learning: await getLearningStats(workspaceId).catch(() => null)
  };
}

/** Día 1 de cada mes (a partir de las 8:00 UTC): informe del mes anterior por email. */
export async function processMonthlyReports(max = 5) {
  const now = new Date();
  if (now.getUTCHours() < 8) return;
  const month = previousMonth(now);
  const rows = await prisma.gmbReviewWatch.findMany({
    where: { enabled: true, monthlyReport: true, lastReportMonth: { not: month }, createdAt: { lt: monthRange(month).to } },
    take: max,
    select: { id: true, workspaceId: true, emails: true, name: true, createdById: true }
  });
  for (const r of rows) {
    // Se marca antes de enviar para no repetir si algo falla a mitad.
    await prisma.gmbReviewWatch.updateMany({ where: { id: r.id, workspaceId: r.workspaceId }, data: { lastReportMonth: month } });
    const emails = r.emails.split(/[,;\s]+/).filter((e) => /@/.test(e));
    if (!emails.length) continue;
    try {
      const data = await monthlyData(r.workspaceId, r.id, month);
      if (!data) continue;
      const { buildMonthlyPdf } = await import("./pdf");
      const { reportBrand, pdfFilename } = await import("./brand");
      const brand = await reportBrand(r.workspaceId, r.createdById);
      const pdf = await buildMonthlyPdf(data, brand);
      const { sendEmailWithAttachment } = await import("@/lib/integrations/email");
      for (const to of emails) {
        await sendEmailWithAttachment({
          workspaceId: r.workspaceId,
          to,
          subject: `Informe de reputación · ${data.name} · ${data.label}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px">Adjuntamos el informe mensual de reputación de <b>${data.name}</b> (${data.label}): ${data.newReviews} reseñas nuevas, ${data.newNeg} negativas, ${data.flagged} sospechosas, ${data.cases.removed} retiradas por Google.</div>`,
          idempotencyKey: `escudo-${r.id}-${month}-${to}`,
          attachment: { filename: pdfFilename("mensual", `${data.name}-${month}`), content: pdf, contentType: "application/pdf" }
        });
      }
    } catch (e) {
      console.warn("[escudo] informe mensual", r.id, (e as Error).message);
    }
  }
}
