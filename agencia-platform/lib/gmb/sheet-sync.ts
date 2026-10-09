/**
 * Vuelca el rendimiento mensual de la ficha al Google Sheets del cliente («Informe GMB - …»).
 *
 * Plantilla (igual para todos los clientes; las pestañas se localizan por nombre):
 *   «Vistas perfil empresa»  Fecha | Vistas        (suma de impresiones Búsqueda+Maps, móvil+ordenador)
 *   «Llamadas»               Fecha | Llamadas
 *   «Cómo llegar»            Fecha | Cómo llegar
 *   «Clicks sitio web»       Fecha | Clicks
 *   «Palabras Clave»         Fecha | Palabra Clave | Apariciones   (top búsquedas del mes)
 * Cada fila es un mes, fechado el día 1 (1/MM/AAAA).
 *
 * Solo AÑADE los meses que falten (nunca toca filas existentes) y solo meses cerrados cuyos datos
 * Google ya ha publicado. Acceso con la cuenta de servicio de Sheets del Hub (la hoja debe estar
 * compartida con ella como Editor).
 */
import { prisma } from "@/lib/db/prisma";
import { appendRows, getSheetsServiceAccount, getSpreadsheetInfo, readRange } from "@/lib/integrations/google-sheets";
import { gbpCall, gbpSourceForClient } from "@/lib/integrations/gmb";
import { ACTION_METRICS, VIEW_METRICS, perfLocationName } from "@/lib/gmb/performance";

type TabKey = "views" | "calls" | "directions" | "website" | "keywords";

const TAB_MATCH: Record<TabKey, RegExp> = {
  views: /vistas|visualizaciones|impresiones/,
  calls: /llamadas/,
  directions: /como llegar|rutas|indicaciones/,
  website: /clic(k)?s|sitio web|web/,
  keywords: /palabras? clave|busquedas|keywords/
};
const TAB_DEFAULT: Record<TabKey, string> = {
  views: "Vistas perfil empresa",
  calls: "Llamadas",
  directions: "Cómo llegar",
  website: "Clicks sitio web",
  keywords: "Palabras Clave"
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** "1/07/2025", "1/7/2025", "2025-07-01" o un número de serie de Sheets → "2025-07". */
export function monthKeyFromCell(v: string | number | null | undefined): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v))) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{1,2})(-\d{1,2})?/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  return null;
}

/** "2025-07" → "1/07/2025" (formato de la plantilla). */
export const cellDate = (mk: string) => `1/${mk.slice(5, 7)}/${mk.slice(0, 4)}`;

const addMonths = (mk: string, n: number) => {
  const d = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthEnd = (mk: string) => new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Localiza las pestañas de la plantilla en el libro. */
export function mapTabs(titles: string[]): Partial<Record<TabKey, string>> {
  const out: Partial<Record<TabKey, string>> = {};
  const used = new Set<string>();
  // Palabras clave primero para que «Clicks sitio web» no se confunda con otras.
  for (const k of ["keywords", "views", "calls", "directions", "website"] as TabKey[]) {
    const exact = titles.find((t) => !used.has(t) && norm(t) === norm(TAB_DEFAULT[k]));
    const t = exact ?? titles.find((x) => !used.has(x) && TAB_MATCH[k].test(norm(x)));
    if (t) {
      out[k] = t;
      used.add(t);
    }
  }
  return out;
}

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

type MonthData = { views: number; calls: number; directions: number; website: number; keywords: { keyword: string; count: number }[] };

/** Datos de Google por mes natural (una llamada diaria agregada + una de búsquedas por mes). */
async function monthlyFromGoogle(workspaceId: string, client: any, months: string[], keywordMonths: Set<string>, topKeywords: number) {
  const loc = perfLocationName(client.locationId);
  if (!loc) throw new Error("La ficha no está vinculada a Google.");
  const source = gbpSourceForClient(client);
  const first = months[0];
  const last = months[months.length - 1];
  const qs = new URLSearchParams();
  for (const m of [...VIEW_METRICS, ...ACTION_METRICS]) qs.append("dailyMetrics", m);
  qs.set("dailyRange.startDate.year", first.slice(0, 4));
  qs.set("dailyRange.startDate.month", String(Number(first.slice(5, 7))));
  qs.set("dailyRange.startDate.day", "1");
  const endIso = monthEnd(last);
  qs.set("dailyRange.endDate.year", endIso.slice(0, 4));
  qs.set("dailyRange.endDate.month", String(Number(endIso.slice(5, 7))));
  qs.set("dailyRange.endDate.day", String(Number(endIso.slice(8, 10))));
  const data = await gbpCall(workspaceId, source, { api: "perf", path: `/v1/${loc}:fetchMultiDailyMetricsTimeSeries?${qs}` });

  const out = new Map<string, MonthData>();
  for (const mk of months) out.set(mk, { views: 0, calls: 0, directions: 0, website: 0, keywords: [] });
  let lastData = "";
  for (const g of data?.multiDailyMetricTimeSeries ?? []) {
    for (const s of g?.dailyMetricTimeSeries ?? []) {
      const metric = String(s.dailyMetric ?? "");
      for (const dv of s?.timeSeries?.datedValues ?? []) {
        if (!dv?.date?.year) continue;
        const mk = `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}`;
        const row = out.get(mk);
        const v = Number(dv.value ?? 0) || 0;
        if (v > 0) {
          const iso = `${mk}-${String(dv.date.day).padStart(2, "0")}`;
          if (iso > lastData) lastData = iso;
        }
        if (!row) continue;
        if ((VIEW_METRICS as readonly string[]).includes(metric)) row.views += v;
        else if (metric === "CALL_CLICKS") row.calls += v;
        else if (metric === "BUSINESS_DIRECTION_REQUESTS") row.directions += v;
        else if (metric === "WEBSITE_CLICKS") row.website += v;
      }
    }
  }
  for (const mk of months) {
    if (!keywordMonths.has(mk)) continue;
    const kq = new URLSearchParams({
      "monthlyRange.startMonth.year": mk.slice(0, 4),
      "monthlyRange.startMonth.month": String(Number(mk.slice(5, 7))),
      "monthlyRange.endMonth.year": mk.slice(0, 4),
      "monthlyRange.endMonth.month": String(Number(mk.slice(5, 7))),
      pageSize: "100"
    });
    try {
      const k = await gbpCall(workspaceId, source, { api: "perf", path: `/v1/${loc}/searchkeywords/impressions/monthly?${kq}` });
      out.get(mk)!.keywords = (k?.searchKeywordsCounts ?? [])
        .map((x: any) => ({ keyword: String(x.searchKeyword ?? ""), count: Number(x?.insightsValue?.value ?? x?.insightsValue?.threshold ?? 0) || 0 }))
        .filter((x: any) => x.keyword)
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, topKeywords);
    } catch {
      /* sin búsquedas ese mes */
    }
  }
  return { months: out, lastData };
}

export type SheetSyncResult = {
  ok: boolean;
  title?: string;
  serviceAccount?: string;
  tabs?: Partial<Record<TabKey, string>>;
  missingTabs?: string[];
  written: { tab: string; months: string[] }[];
  upToDate?: boolean;
  pendingMonth?: string | null;
  message?: string;
};

/**
 * Sincroniza la hoja del cliente: añade los meses cerrados que falten en cada pestaña.
 * Si una pestaña está vacía, rellena los últimos `backfillMonths` meses.
 */
export async function syncClientSheet(workspaceId: string, clientId: string, opts: { backfillMonths?: number; topKeywords?: number } = {}): Promise<SheetSyncResult> {
  const client = await prisma.gmbClient.findFirst({ where: { id: clientId, workspaceId } });
  if (!client) throw new Error("Ficha no encontrada");
  const url = String(client.reportSheetUrl ?? "").trim();
  if (!url) return { ok: false, written: [], message: "La ficha no tiene spreadsheet vinculado." };
  const sa = await getSheetsServiceAccount(workspaceId);
  const info = await getSpreadsheetInfo({ workspaceId, spreadsheetId: url });
  const tabs = mapTabs(info.sheets.map((s) => s.title));
  const missingTabs = (Object.keys(TAB_DEFAULT) as TabKey[]).filter((k) => !tabs[k]).map((k) => TAB_DEFAULT[k]);

  // Último mes cerrado.
  const now = new Date();
  const lastClosed = `${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)}`;
  const backfill = Math.max(1, Math.min(opts.backfillMonths ?? 12, 17));

  // Qué meses faltan en cada pestaña.
  const have: Partial<Record<TabKey, Set<string>>> = {};
  const need = new Map<TabKey, string[]>();
  for (const k of Object.keys(tabs) as TabKey[]) {
    const col = await readRange({ workspaceId, spreadsheetId: url, range: `${q(tabs[k]!)}!A2:A` });
    const set = new Set(col.map((r) => monthKeyFromCell(r[0])).filter((x): x is string => !!x));
    have[k] = set;
    const latest = [...set].sort().pop();
    const start = latest ? addMonths(latest, 1) : addMonths(lastClosed, -(backfill - 1));
    const list: string[] = [];
    for (let mk = start; mk <= lastClosed; mk = addMonths(mk, 1)) if (!set.has(mk)) list.push(mk);
    if (list.length) need.set(k, list);
  }
  if (!need.size) {
    await prisma.gmbClient.updateMany({ where: { id: client.id, workspaceId }, data: { reportSheetSyncedAt: new Date() } });
    return { ok: true, title: info.title, serviceAccount: sa.client_email, tabs, missingTabs, written: [], upToDate: true, pendingMonth: null };
  }

  const all = [...new Set([...need.values()].flat())].sort();
  const kwMonths = new Set(need.get("keywords") ?? []);
  const { months, lastData } = await monthlyFromGoogle(workspaceId, client, all, kwMonths, opts.topKeywords ?? 10);
  // Un mes solo se escribe si Google ya ha publicado datos hasta su último día.
  const ready = (mk: string) => !!lastData && lastData >= monthEnd(mk);

  const written: SheetSyncResult["written"] = [];
  let pendingMonth: string | null = null;
  for (const [k, list] of need) {
    const ok = list.filter(ready);
    if (ok.length < list.length) pendingMonth = list.find((m) => !ready(m)) ?? pendingMonth;
    if (!ok.length) continue;
    let rows: (string | number)[][];
    if (k === "keywords") {
      rows = ok.flatMap((mk) => months.get(mk)!.keywords.map((kw) => [cellDate(mk), kw.keyword, kw.count]));
    } else {
      const field = k as "views" | "calls" | "directions" | "website";
      rows = ok.map((mk) => [cellDate(mk), months.get(mk)![field]]);
    }
    if (!rows.length) continue;
    await appendRows({ workspaceId, spreadsheetId: url, range: `${q(tabs[k]!)}!A:${k === "keywords" ? "C" : "B"}`, rows, valueInputOption: "RAW" });
    written.push({ tab: tabs[k]!, months: ok });
  }
  await prisma.gmbClient.updateMany({ where: { id: client.id, workspaceId }, data: { reportSheetSyncedAt: new Date() } });
  return { ok: true, title: info.title, serviceAccount: sa.client_email, tabs, missingTabs, written, upToDate: written.length === 0 && !pendingMonth, pendingMonth };
}

/* ───────────────────── Sincronización automática (cron) ───────────────────── */

const lastRun = new Map<string, number>();

/** Revisa cada 12 h las fichas con hoja vinculada y añade el mes cerrado en cuanto Google lo publica. */
export async function processAllSheetSyncs(max = 20) {
  const rows = await prisma.gmbClient.findMany({
    where: { status: "active", locationId: { not: "" }, reportSheetUrl: { not: "" } },
    select: { id: true, workspaceId: true },
    take: 300
  });
  let n = 0;
  for (const r of rows) {
    if (n >= max) break;
    if (Date.now() - (lastRun.get(r.id) ?? 0) < 12 * 3_600_000) continue;
    lastRun.set(r.id, Date.now());
    n++;
    await syncClientSheet(r.workspaceId, r.id).catch((e) => console.warn("[gmb] sheet-sync:", r.id, (e as Error).message));
  }
  return { checked: n };
}
