/**
 * Rendimiento de la ficha (lo mismo que «Rendimiento» en Google): visualizaciones del perfil
 * (Búsqueda/Maps × móvil/ordenador), interacciones (llamadas, cómo llegar, web, mensajes,
 * reservas, pedidos) y búsquedas que mostraron la ficha. API Business Profile Performance v1,
 * vía OAuth del Hub o la pasarela de Make. Compara con el periodo anterior de igual duración.
 */
import { gbpCall, gbpSourceForClient } from "@/lib/integrations/gmb";

export const VIEW_METRICS = [
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS"
] as const;
export const ACTION_METRICS = [
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "WEBSITE_CLICKS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS"
] as const;
const ALL = [...VIEW_METRICS, ...ACTION_METRICS];

type Ymd = { year: number; month: number; day: number };
const ymd = (d: Date): Ymd => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const iso = (d: Ymd) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const DAY = 86_400_000;

export function perfLocationName(locationId: string | null | undefined): string | null {
  const m = String(locationId ?? "").match(/(\d{5,})\s*$/);
  return m ? `locations/${m[1]}` : null;
}

export type PerfTotals = Record<string, number>;
export type PerformanceResult = {
  range: { since: string; until: string; days: number };
  prevRange: { since: string; until: string; complete: boolean };
  totals: PerfTotals;
  prevTotals: PerfTotals;
  views: number;
  prevViews: number;
  interactions: number;
  prevInteractions: number;
  daily: { date: string; views: number; interactions: number; calls: number; directions: number; website: number }[];
  keywords: { keyword: string; impressions: number | null; threshold: number | null }[];
  keywordsMonths: string;
  searches: number;
  /** Último día con datos publicados por Google. */
  dataUntil: string;
};

const cache = new Map<string, { at: number; data: PerformanceResult }>();

export async function fetchPerformance(
  workspaceId: string,
  client: { id: string; locationId: string | null; accountId?: string | null; [k: string]: any },
  opts: { days?: number; fresh?: boolean; since?: string; until?: string; /** compara con el mes natural anterior completo */ calendarMonth?: boolean } = {}
): Promise<PerformanceResult> {
  const loc = perfLocationName(client.locationId);
  if (!loc) throw new Error("La ficha no está vinculada a Google (falta la ubicación).");
  const yesterday = new Date(Date.now() - DAY);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // Rango explícito (informe): desde/hasta elegidos. Si no, últimos `days` hasta el último día con datos.
  let fixed: { start: Date; end: Date } | null = null;
  if (opts.since && opts.until && DATE_RE.test(opts.since) && DATE_RE.test(opts.until)) {
    let s0 = new Date(`${opts.since}T00:00:00Z`);
    let e0 = new Date(`${opts.until}T00:00:00Z`);
    if (e0 > yesterday) e0 = new Date(`${iso(ymd(yesterday))}T00:00:00Z`);
    if (s0 > e0) s0 = e0;
    fixed = { start: s0, end: e0 };
  }
  const days = fixed
    ? Math.min(Math.round((fixed.end.getTime() - fixed.start.getTime()) / DAY) + 1, 540)
    : Math.max(7, Math.min(opts.days ?? 30, 540));
  const key = `${workspaceId}:${client.id}:${days}:${fixed ? iso(ymd(fixed.start)) : "auto"}:${opts.calendarMonth ? "m" : ""}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < 3_600_000) return hit.data;

  const source = gbpSourceForClient(client as any);
  // Google tarda unos días en consolidar: pedimos hasta ayer con margen y el periodo termina en el
  // último día que ya tiene datos (así la comparación no queda falseada por días aún a 0).
  const fetchTo = fixed ? fixed.end : yesterday;
  const fetchFrom = fixed ? new Date(fixed.start.getTime() - Math.max(days, 31) * DAY) : new Date(yesterday.getTime() - (2 * days + 9) * DAY);

  const qs = new URLSearchParams();
  for (const m of ALL) qs.append("dailyMetrics", m);
  const a = ymd(fetchFrom);
  const b = ymd(fetchTo);
  qs.set("dailyRange.startDate.year", String(a.year));
  qs.set("dailyRange.startDate.month", String(a.month));
  qs.set("dailyRange.startDate.day", String(a.day));
  qs.set("dailyRange.endDate.year", String(b.year));
  qs.set("dailyRange.endDate.month", String(b.month));
  qs.set("dailyRange.endDate.day", String(b.day));
  const data = await gbpCall(workspaceId, source, { api: "perf", path: `/v1/${loc}:fetchMultiDailyMetricsTimeSeries?${qs}` });

  const byDay = new Map<string, Record<string, number>>();
  let lastData = "";
  for (const group of data?.multiDailyMetricTimeSeries ?? []) {
    for (const s of group?.dailyMetricTimeSeries ?? []) {
      const metric = String(s.dailyMetric ?? "");
      for (const dv of s?.timeSeries?.datedValues ?? []) {
        if (!dv?.date?.year) continue;
        const date = iso(dv.date);
        const v = Number(dv.value ?? 0) || 0;
        const row = byDay.get(date) ?? {};
        row[metric] = (row[metric] ?? 0) + v;
        byDay.set(date, row);
        if (v > 0 && date > lastData) lastData = date;
      }
    }
  }
  const yIso = iso(ymd(yesterday));
  const minEnd = iso(ymd(new Date(yesterday.getTime() - 9 * DAY)));
  const endIso = fixed ? iso(ymd(fixed.end)) : lastData && lastData >= minEnd ? lastData : yIso;
  const end = new Date(`${endIso}T00:00:00Z`);
  const start = fixed ? fixed.start : new Date(end.getTime() - (days - 1) * DAY);
  const prevEnd = new Date(start.getTime() - DAY);
  const prevStart = opts.calendarMonth
    ? new Date(Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), 1))
    : new Date(prevEnd.getTime() - (days - 1) * DAY);
  const startIso = iso(ymd(start));
  const prevStartIso = iso(ymd(prevStart));

  const totals: PerfTotals = Object.fromEntries(ALL.map((m) => [m, 0]));
  const prevTotals: PerfTotals = Object.fromEntries(ALL.map((m) => [m, 0]));
  for (const [date, row] of byDay) {
    const target = date >= startIso && date <= endIso ? totals : date >= prevStartIso && date < startIso ? prevTotals : null;
    if (!target) continue;
    for (const [m, v] of Object.entries(row)) target[m] = (target[m] ?? 0) + v;
  }
  const sum = (t: PerfTotals, ms: readonly string[]) => ms.reduce((s, m) => s + (t[m] ?? 0), 0);

  const daily: PerformanceResult["daily"] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const date = iso(ymd(new Date(t)));
    const r = byDay.get(date) ?? {};
    daily.push({
      date,
      views: sum(r, VIEW_METRICS),
      interactions: sum(r, ACTION_METRICS),
      calls: r.CALL_CLICKS ?? 0,
      directions: r.BUSINESS_DIRECTION_REQUESTS ?? 0,
      website: r.WEBSITE_CLICKS ?? 0
    });
  }

  // Búsquedas (mensual): meses completos que cubren el periodo.
  const kwFrom = ymd(start);
  const kwTo = ymd(end);
  const kq = new URLSearchParams({
    "monthlyRange.startMonth.year": String(kwFrom.year),
    "monthlyRange.startMonth.month": String(kwFrom.month),
    "monthlyRange.endMonth.year": String(kwTo.year),
    "monthlyRange.endMonth.month": String(kwTo.month),
    pageSize: "100"
  });
  const keywords: PerformanceResult["keywords"] = [];
  try {
    let token = "";
    for (let i = 0; i < 3; i++) {
      if (token) kq.set("pageToken", token);
      const k = await gbpCall(workspaceId, source, { api: "perf", path: `/v1/${loc}/searchkeywords/impressions/monthly?${kq}` });
      for (const x of k?.searchKeywordsCounts ?? []) {
        const v = x?.insightsValue?.value;
        const th = x?.insightsValue?.threshold;
        keywords.push({
          keyword: String(x.searchKeyword ?? ""),
          impressions: v != null ? Number(v) : null,
          threshold: th != null ? Number(th) : null
        });
      }
      token = k?.nextPageToken ?? "";
      if (!token) break;
    }
  } catch {
    /* sin datos de búsquedas: seguimos con el resto */
  }
  keywords.sort((x, y) => (y.impressions ?? y.threshold ?? 0) - (x.impressions ?? x.threshold ?? 0));
  const searches = keywords.reduce((s, k) => s + (k.impressions ?? 0), 0);

  const result: PerformanceResult = {
    range: { since: startIso, until: iso(ymd(end)), days },
    // Google solo guarda ~18 meses: si el periodo anterior empieza antes, la comparación no es fiable.
    prevRange: { since: iso(ymd(prevStart)), until: iso(ymd(prevEnd)), complete: prevStart.getTime() >= Date.now() - 535 * DAY },
    totals,
    prevTotals,
    views: sum(totals, VIEW_METRICS),
    prevViews: sum(prevTotals, VIEW_METRICS),
    interactions: sum(totals, ACTION_METRICS),
    prevInteractions: sum(prevTotals, ACTION_METRICS),
    daily,
    keywords,
    keywordsMonths: `${kwFrom.year}-${String(kwFrom.month).padStart(2, "0")} → ${kwTo.year}-${String(kwTo.month).padStart(2, "0")}`,
    searches,
    dataUntil: lastData
  };
  cache.set(key, { at: Date.now(), data: result });
  return result;
}
