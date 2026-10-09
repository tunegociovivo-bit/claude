/**
 * PDF del informe de ficha (pdfkit, en servidor): misma información y mismos criterios que la
 * página /gmb-hub/report/[id] en modo «real» o «cliente». Se descarga directamente, sin
 * depender del diálogo de impresión del navegador.
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { pdfText } from "@/lib/gmb/fake-reviews/pdf";
import { buildNextSteps, buildSummary, conversion, pct, type ReportMode } from "@/lib/gmb/client-report-text";
import type { ClientReport } from "@/lib/gmb/client-report";

const INK = "#0F172A";
const MUTED = "#64748B";
const LIGHT = "#94A3B8";
const LINE = "#E2E8F0";
const GREEN = "#059669";
const RED = "#E11D48";
const AMBER = "#D97706";
const STAR = "#F5B301";

const nfmt = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(n) ? "–" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const longDate = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
const shortDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "");

export function fonts(doc: PDFKit.PDFDocument) {
  const dir = path.join(process.cwd(), "public", "fonts");
  try {
    doc.registerFont("R", fs.readFileSync(path.join(dir, "Inter-Regular.ttf")));
    doc.registerFont("B", fs.readFileSync(path.join(dir, "Inter-Bold.ttf")));
  } catch {
    doc.registerFont("R", "Helvetica");
    doc.registerFont("B", "Helvetica-Bold");
  }
}

export class W {
  d: PDFKit.PDFDocument;
  L = 44;
  Wd: number;
  constructor(d: PDFKit.PDFDocument, public accent: string) {
    this.d = d;
    this.Wd = d.page.width - 88;
  }
  get bottom() {
    return this.d.page.height - 56;
  }
  ensure(h: number) {
    if (this.d.y + h > this.bottom) {
      this.d.addPage();
      this.d.y = 48;
    }
  }
  h2(t: string) {
    this.ensure(70);
    const d = this.d;
    d.y += 10;
    d.fillColor(INK).font("B").fontSize(12.5).text(pdfText(t), this.L, d.y, { width: this.Wd });
    const y = d.y + 2;
    d.moveTo(this.L, y).lineTo(this.L + 40, y).lineWidth(2).strokeColor(this.accent).stroke();
    d.y = y + 8;
  }
  sub(t: string, keepWith = 0) {
    this.ensure(24 + keepWith);
    this.d.fillColor(MUTED).font("B").fontSize(9).text(pdfText(t), this.L, this.d.y, { width: this.Wd });
    this.d.y += 3;
  }
  p(t: string, o: { size?: number; color?: string; bold?: boolean; x?: number; w?: number } = {}) {
    const d = this.d;
    const x = o.x ?? this.L;
    const w = o.w ?? this.Wd - (x - this.L);
    d.font(o.bold ? "B" : "R").fontSize(o.size ?? 9.5);
    this.ensure(d.heightOfString(pdfText(t), { width: w, lineGap: 1.5 }) + 3);
    d.fillColor(o.color ?? INK).text(pdfText(t), x, d.y, { width: w, lineGap: 1.5 });
    d.y += 2;
  }
  bullet(t: string, color: string) {
    const d = this.d;
    d.font("R").fontSize(9.5);
    const h = d.heightOfString(pdfText(t), { width: this.Wd - 14, lineGap: 1.5 });
    this.ensure(h + 4);
    const y = d.y;
    d.circle(this.L + 3, y + 5.5, 2.4).fill(color);
    d.fillColor(INK).font("R").fontSize(9.5).text(pdfText(t), this.L + 12, y, { width: this.Wd - 14, lineGap: 1.5 });
    d.y += 3;
  }
  /** Rejilla de tarjetas (n por fila). */
  cards(items: { label: string; value: string; delta?: { text: string; color: string } | null; sub?: string }[], perRow = 3) {
    const d = this.d;
    const gap = 8;
    const cw = (this.Wd - gap * (perRow - 1)) / perRow;
    const ch = 50;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(ch + gap);
      const y = d.y;
      items.slice(i, i + perRow).forEach((it, j) => {
        const x = this.L + j * (cw + gap);
        d.roundedRect(x, y, cw, ch, 6).lineWidth(0.8).strokeColor(LINE).stroke();
        d.fillColor(MUTED).font("R").fontSize(7.5).text(pdfText(it.label), x + 8, y + 7, { width: cw - 16, lineBreak: false, ellipsis: true });
        d.fillColor(INK).font("B").fontSize(15).text(pdfText(it.value), x + 8, y + 18, { width: cw - 16, lineBreak: false, continued: false });
        if (it.delta) {
          const vw = d.font("B").fontSize(15).widthOfString(pdfText(it.value));
          d.fillColor(it.delta.color).font("B").fontSize(8).text(it.delta.text, x + 12 + vw, y + 24, { lineBreak: false });
        }
        if (it.sub) d.fillColor(LIGHT).font("R").fontSize(7).text(pdfText(it.sub), x + 8, y + 38, { width: cw - 16, lineBreak: false, ellipsis: true });
      });
      d.y = y + ch + gap;
    }
  }
  bars(rows: [string, number, number][], color: string) {
    const d = this.d;
    for (const [label, v, share] of rows) {
      this.ensure(20);
      const y = d.y;
      d.fillColor(INK).font("R").fontSize(8.5).text(pdfText(label), this.L, y, { width: this.Wd * 0.6, lineBreak: false });
      d.fillColor(MUTED).text(`${nfmt(v)} · ${nfmt(share)}%`, this.L, y, { width: this.Wd, align: "right", lineBreak: false });
      d.roundedRect(this.L, y + 11, this.Wd, 3.5, 1.7).fill("#F1F5F9");
      if (share > 0) d.roundedRect(this.L, y + 11, Math.max(2, (this.Wd * share) / 100), 3.5, 1.7).fill(color);
      d.y = y + 20;
    }
  }
  table(head: string[], rows: string[][], widths: number[], align: ("left" | "right")[] = []) {
    const d = this.d;
    const tot = widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => (w / tot) * this.Wd);
    const row = (cells: string[], bold: boolean, color: string) => {
      d.font(bold ? "B" : "R").fontSize(8.5);
      const h = Math.max(...cells.map((c, i) => d.heightOfString(pdfText(c), { width: ws[i] - 6 }))) + 6;
      this.ensure(h + 2);
      const y = d.y;
      let x = this.L;
      cells.forEach((c, i) => {
        d.fillColor(color).font(bold ? "B" : "R").fontSize(8.5).text(pdfText(c), x + 3, y + 3, { width: ws[i] - 6, align: align[i] ?? "left" });
        x += ws[i];
      });
      d.y = y + h;
      d.moveTo(this.L, d.y).lineTo(this.L + this.Wd, d.y).lineWidth(0.5).strokeColor(LINE).stroke();
    };
    row(head, true, MUTED);
    for (const r of rows) row(r, false, INK);
    d.y += 4;
  }
  review(r: { author: string; rating: number; comment: string | null; time: string | null }, highlight = false, quote = false) {
    const d = this.d;
    const head = `${r.author}  ·  ${shortDate(r.time)}`;
    const clean = String(r.comment ?? "").replace(/\p{Extended_Pictographic}(\uFE0F|\p{Emoji_Modifier})?/gu, "").replace(/\s{2,}/g, " ").trim();
    const body = clean ? (quote ? `“${clean}”` : clean) : "";
    d.font("R").fontSize(8.8);
    const hb = body ? d.heightOfString(pdfText(body), { width: this.Wd - 16, lineGap: 1 }) : 0;
    const h = 20 + hb + 6;
    this.ensure(h + 4);
    const y = d.y;
    if (highlight) d.roundedRect(this.L, y, this.Wd, h, 4).fill("#FFF1F2");
    d.fillColor(INK).font("B").fontSize(8.8).text(pdfText(head), this.L + 8, y + 6, { width: this.Wd - 90, lineBreak: false, ellipsis: true });
    d.fillColor(STAR).font("B").fontSize(9).text("★".repeat(r.rating), this.L, y + 6, { width: this.Wd - 8, align: "right", lineBreak: false });
    if (body) d.fillColor("#334155").font("R").fontSize(8.8).text(pdfText(body), this.L + 8, y + 19, { width: this.Wd - 16, lineGap: 1 });
    d.y = y + h;
    d.moveTo(this.L, d.y).lineTo(this.L + this.Wd, d.y).lineWidth(0.5).strokeColor(LINE).stroke();
    d.y += 4;
  }
}

function deltaFor(now: number, prev: number | null | undefined, mode: ReportMode, comparable: boolean) {
  if (prev == null || !comparable) return null;
  const v = pct(now, prev);
  if (v === null) return { text: "nuevo", color: GREEN };
  if (mode === "cliente" && v <= 0) return null;
  return { text: `${v >= 0 ? "+" : "−"}${nfmt(Math.abs(v), Math.abs(v) < 10 ? 1 : 0)}%`, color: v >= 0 ? GREEN : RED };
}

function trendChart(w: W, days: { date: string; views: number; interactions: number }[], mode: ReportMode) {
  const d = w.d;
  const H = 110;
  w.ensure(H + 26);
  const x0 = w.L;
  const y0 = d.y;
  const Wd = w.Wd;
  if (!days.length) return;
  if (mode === "real") {
    const pts =
      days.length > 62
        ? Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => {
            const c = days.slice(i * 7, i * 7 + 7);
            return { date: c[0].date, views: c.reduce((s, x) => s + x.views, 0), interactions: c.reduce((s, x) => s + x.interactions, 0) };
          })
        : days;
    const maxV = Math.max(1, ...pts.map((p) => p.views));
    const maxI = Math.max(1, ...pts.map((p) => p.interactions));
    const bw = Wd / pts.length;
    pts.forEach((p, i) => {
      const h = (H - 8) * (p.views / maxV);
      d.rect(x0 + i * bw + bw * 0.12, y0 + H - h, Math.max(0.8, bw * 0.76), h).fillOpacity(0.35).fill(w.accent);
    });
    d.fillOpacity(1);
    pts.forEach((p, i) => {
      const x = x0 + i * bw + bw / 2;
      const y = y0 + 4 + (H - 8) * (1 - p.interactions / maxI);
      if (i === 0) d.moveTo(x, y);
      else d.lineTo(x, y);
    });
    d.lineWidth(1.4).strokeColor(AMBER).stroke();
    d.fillColor(LIGHT).font("R").fontSize(7).text("barras: visualizaciones · línea: interacciones", x0, y0 - 2, { width: Wd, align: "right" });
  } else {
    let v = 0;
    let it = 0;
    const pts = days.map((p) => ({ v: (v += p.views), i: (it += p.interactions) }));
    const mv = Math.max(1, v) * 1.03;
    const mi = Math.max(1, it) * 1.03;
    const X = (i: number) => x0 + (pts.length > 1 ? (Wd * i) / (pts.length - 1) : 0);
    d.moveTo(x0, y0 + H);
    pts.forEach((p, i) => d.lineTo(X(i), y0 + H * (1 - p.v / mv)));
    d.lineTo(x0 + Wd, y0 + H).closePath().fillOpacity(0.12).fill(w.accent);
    d.fillOpacity(1);
    pts.forEach((p, i) => (i ? d.lineTo(X(i), y0 + H * (1 - p.v / mv)) : d.moveTo(X(i), y0 + H * (1 - p.v / mv))));
    d.lineWidth(1.8).strokeColor(w.accent).stroke();
    pts.forEach((p, i) => (i ? d.lineTo(X(i), y0 + H * (1 - p.i / mi)) : d.moveTo(X(i), y0 + H * (1 - p.i / mi))));
    d.lineWidth(1.8).strokeColor(AMBER).stroke();
    d.fillColor(w.accent).font("B").fontSize(8.5).text(`${nfmt(v)} visualizaciones`, x0 + 4, y0 + 2);
    d.fillColor(AMBER).font("B").fontSize(8.5).text(`${nfmt(it)} interacciones`, x0 + 4, y0 + 14);
  }
  d.moveTo(x0, y0 + H).lineTo(x0 + Wd, y0 + H).lineWidth(0.5).strokeColor(LINE).stroke();
  d.fillColor(LIGHT).font("R").fontSize(7).text(shortDate(days[0].date), x0, y0 + H + 3, { lineBreak: false });
  d.text(shortDate(days[days.length - 1].date), x0, y0 + H + 3, { width: Wd, align: "right", lineBreak: false });
  d.y = y0 + H + 16;
}

export async function buildClientReportPdf(data: NonNullable<ClientReport>, mode: ReportMode): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 40, left: 44, right: 44 }, bufferPages: true, info: { Title: `Informe ${data.client.name}` } });
  fonts(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const accent = data.branding?.color || "#2563EB";
  const w = new W(doc, accent);
  const real = mode === "real";
  const perf: any = data.performance?.ok ? data.performance : null;
  const t = perf?.totals ?? {};
  const pt = perf?.prevTotals ?? {};
  const cx = conversion(data);
  const rv = data.reviews;

  // Portada / cabecera
  doc.rect(0, 0, doc.page.width, 128).fill(accent);
  doc.fillColor("#FFFFFF").font("B").fontSize(8.5).text(pdfText(`INFORME DE GOOGLE BUSINESS PROFILE${real ? " · INTERNO" : ""}`), w.L, 30, { characterSpacing: 0.8 });
  doc.font("B").fontSize(19).text(pdfText(data.client.name), w.L, 44, { width: w.Wd - 110 });
  doc.font("R").fontSize(9).text(pdfText([data.client.category, data.client.address].filter(Boolean).join(" · ")), w.L, doc.y + 2, { width: w.Wd - 110 });
  doc.font("R").fontSize(9.5).text(pdfText(`Periodo: ${longDate(data.period.from)} – ${longDate(data.period.to)} (${data.period.days} días)`), w.L, doc.y + 4, { width: w.Wd - 110 });
  doc.font("B").fontSize(24).text(`${nfmt(data.client.rating, 1)} ★`, w.L, 40, { width: w.Wd, align: "right" });
  doc.font("R").fontSize(8.5).text(pdfText(`${nfmt(data.client.reviewCount || rv.overall.total)} reseñas en Google`), w.L, 70, { width: w.Wd, align: "right" });
  doc.y = 146;

  // Resumen
  w.h2(real ? "Resumen del periodo" : "Lo más destacado");
  for (const s of buildSummary(data, mode, cx)) w.bullet(s.text, s.tone === "bad" ? RED : s.tone === "good" ? GREEN : LIGHT);

  // Rendimiento
  w.h2("Rendimiento en Google");
  if (!perf) {
    w.p(`No se pudieron obtener los datos de rendimiento de Google${real && (data.performance as any)?.message ? `: ${(data.performance as any).message}` : "."}`, { color: MUTED });
  } else {
    const items: { label: string; value: string; delta?: any; sub?: string }[] = [];
    const add = (label: string, now: number, prev: number | null) =>
      items.push({ label, value: nfmt(now), delta: deltaFor(now, prev, mode, cx.comparable), sub: real && prev != null && cx.comparable ? `antes: ${nfmt(prev)}` : undefined });
    add("Visualizaciones del perfil", perf.views, perf.prevViews);
    add("Búsquedas que mostraron la ficha", perf.searches, null);
    add("Interacciones totales", perf.interactions, perf.prevInteractions);
    add("Llamadas", t.CALL_CLICKS ?? 0, pt.CALL_CLICKS ?? 0);
    add("Solicitudes de cómo llegar", t.BUSINESS_DIRECTION_REQUESTS ?? 0, pt.BUSINESS_DIRECTION_REQUESTS ?? 0);
    add("Clics en el sitio web", t.WEBSITE_CLICKS ?? 0, pt.WEBSITE_CLICKS ?? 0);
    if ((t.BUSINESS_CONVERSATIONS ?? 0) + (pt.BUSINESS_CONVERSATIONS ?? 0) > 0) add("Mensajes", t.BUSINESS_CONVERSATIONS ?? 0, pt.BUSINESS_CONVERSATIONS ?? 0);
    if ((t.BUSINESS_BOOKINGS ?? 0) + (pt.BUSINESS_BOOKINGS ?? 0) > 0) add("Reservas", t.BUSINESS_BOOKINGS ?? 0, pt.BUSINESS_BOOKINGS ?? 0);
    if (cx.conv != null && (real || !cx.comparable || (cx.prevConv != null && cx.conv >= cx.prevConv)))
      items.push({ label: "Tasa de interacción", value: `${nfmt(cx.conv, 1)}%`, sub: `de cada 100 visitas, ${nfmt(cx.conv)} actúan` });
    w.cards(items, 3);
    if (real && cx.comparable) w.p(`Comparado con ${shortDate(data.period.prevFrom)} – ${shortDate(data.period.prevTo)}.`, { size: 7.5, color: LIGHT });
    w.sub(real ? "Visualizaciones e interacciones por día" : "Crecimiento acumulado de visualizaciones e interacciones", 140);
    w.ensure(150);
    trendChart(w, perf.daily ?? [], mode);
    w.sub("Dónde te ven");
    const views = perf.views || 1;
    w.bars(
      [
        ["Búsqueda de Google · móvil", t.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0, ((t.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0) / views) * 100],
        ["Búsqueda de Google · ordenador", t.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0, ((t.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) / views) * 100],
        ["Google Maps · móvil", t.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0, ((t.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0) / views) * 100],
        ["Google Maps · ordenador", t.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0, ((t.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0) / views) * 100]
      ],
      accent
    );
    if (perf.keywords?.length) {
      w.sub("Búsquedas con las que te encontraron");
      w.table(
        ["#", "Búsqueda", "Veces"],
        perf.keywords.slice(0, 12).map((k: any, i: number) => [String(i + 1), k.keyword, k.impressions != null ? nfmt(k.impressions) : `< ${k.threshold ?? 15}`]),
        [6, 74, 20],
        ["left", "left", "right"]
      );
    }
  }

  // Reseñas
  w.h2("Reseñas");
  const p = rv.period;
  const posShare = p.total ? Math.round((p.positive / p.total) * 100) : Math.round((rv.overall.positive / Math.max(1, rv.overall.total)) * 100);
  const rc: any[] = [{ label: "Reseñas nuevas", value: nfmt(p.total), sub: real ? `antes: ${rv.previous.total}` : undefined }];
  if (real || (p.total && p.avg >= Math.min(4.5, rv.overall.avg)))
    rc.push({ label: "Valoración media del periodo", value: p.total ? `${nfmt(p.avg, 1)} ★` : "–", sub: real && rv.previous.total ? `antes: ${nfmt(rv.previous.avg, 1)} ★` : undefined });
  rc.push({ label: "Valoraciones positivas (4-5★)", value: `${posShare}%` });
  if (real || p.responseRate >= 60) rc.push({ label: "Reseñas respondidas", value: p.total ? `${p.responseRate}%` : "–", sub: real && p.unreplied ? `${p.unreplied} sin responder` : undefined });
  if (!real) rc.push({ label: "Reputación global", value: `${nfmt(rv.overall.avg, 1)} ★`, sub: `${nfmt(rv.overall.total)} opiniones` });
  w.cards(rc, 3);
  if (real && p.total) {
    w.sub("Distribución del periodo");
    w.bars(
      [5, 4, 3, 2, 1].map((s) => [`${s} estrellas`, p.distribution[s] ?? 0, ((p.distribution[s] ?? 0) / p.total) * 100] as [string, number, number]),
      accent
    );
  }
  // Reseñas por mes
  w.sub("Reseñas por mes (12 meses)", 80);
  {
    const H = 56;
    w.ensure(H + 18);
    const y0 = doc.y;
    const maxM = Math.max(1, ...rv.monthly.map((m) => m.count));
    const bw = w.Wd / rv.monthly.length;
    rv.monthly.forEach((m, i) => {
      const h = (H - 10) * (m.count / maxM);
      if (h > 0) doc.rect(w.L + i * bw + bw * 0.15, y0 + H - h, bw * 0.7, h).fillOpacity(0.6).fill(accent);
      doc.fillOpacity(1).fillColor(LIGHT).font("R").fontSize(6.5).text(m.month.slice(5), w.L + i * bw, y0 + H + 2, { width: bw, align: "center" });
      if (m.count) doc.fillColor(MUTED).fontSize(6.5).text(String(m.count), w.L + i * bw, y0 + H - h - 9, { width: bw, align: "center" });
    });
    doc.y = y0 + H + 14;
  }
  const featured = rv.list.filter((r) => r.rating >= 4 && r.comment).slice(0, 4);
  const list = real ? rv.list.slice(0, 15) : featured.length ? featured : rv.bestOverall.slice(0, 3);
  w.sub(real ? "Reseñas del periodo" : "Lo que dicen los clientes");
  if (!list.length) w.p(real ? "No hubo reseñas nuevas en este periodo." : "", { color: MUTED, size: 8.5 });
  for (const r of list) w.review(r, real && r.rating <= 2, !real);

  // Publicaciones
  if (real || data.posts.count > 0) {
    w.h2("Publicaciones en Google");
    w.p(`${data.posts.count} publicaciones en el periodo${real && data.posts.previous != null ? ` (periodo anterior: ${data.posts.previous})` : ""}.`);
    for (const ps of data.posts.list.slice(0, 6)) w.p(`${shortDate(ps.date)} — ${ps.text}`, { size: 8.5, color: "#334155" });
  }

  // Posicionamiento
  const rk = data.ranking.filter((r) => real || (r.avgPosition && r.avgPosition <= 10) || (r.prevAvgPosition && r.avgPosition && r.avgPosition < r.prevAvgPosition));
  if (rk.length) {
    w.h2("Posicionamiento en Google Maps");
    w.table(
      ["Palabra clave", "Posición media", "Visibilidad", "Top 3"],
      rk.map((r) => [
        r.keyword,
        `${r.avgPosition ? nfmt(r.avgPosition, 1) : "No aparece"}${r.prevAvgPosition && r.avgPosition && (real || r.avgPosition < r.prevAvgPosition) ? ` (antes ${nfmt(r.prevAvgPosition, 1)})` : ""}`,
        r.visibility != null ? `${r.visibility}%` : "–",
        r.top3Share != null ? `${r.top3Share}%` : "–"
      ]),
      [46, 26, 14, 14],
      ["left", "right", "right", "right"]
    );
  }

  // Reseñas falsas
  const fk: any = data.fake;
  if (fk === null && real) {
    w.h2("Reseñas falsas");
    w.p("No hay ningún análisis de reseñas falsas terminado para esta ficha. Lánzalo en la pestaña «Reseñas falsas».", { color: MUTED });
  } else if (fk && (real || fk.stats.removable + fk.stats.high > 0)) {
    const st = fk.stats;
    w.h2(real ? "Reseñas falsas y reseñas eliminables" : "Protección de la reputación");
    w.p(`Análisis del ${shortDate(fk.date)}${fk.label ? ` · ${fk.label}` : ""}`, { size: 7.5, color: LIGHT });
    const fc: any[] = [
      { label: "Eliminables por política", value: nfmt(st.removable), sub: `${st.removableHigh} con probabilidad alta` },
      { label: "Perfiles de riesgo alto", value: nfmt(st.high), sub: real ? `${st.medium} de riesgo medio` : undefined }
    ];
    if (fk.impact && fk.impact.removed > 0) fc.push({ label: "Valoración sin ellas", value: `${nfmt(fk.impact.without, 1)} ★`, sub: `ahora ${nfmt(fk.impact.current, 1)} ★` });
    if (real) fc.push({ label: "Redes de perfiles", value: nfmt(st.networks), sub: st.competitorFakes ? `${st.competitorFakes} positivas sospechosas en la competencia` : undefined });
    w.cards(fc, real ? 4 : 3);
    if (real && fk.aiSummary) w.p(fk.aiSummary, { size: 8.8 });
    if (fk.removable.length) {
      w.sub("Reseñas que se pueden denunciar a Google");
      for (const f of fk.removable.slice(0, real ? 12 : 6)) {
        w.p(`${f.author || "Usuario de Google"} · ${"★".repeat(f.rating)} · probabilidad de retirada: ${f.likelihood}`, { bold: true, size: 8.8, color: f.likelihood === "alta" ? RED : f.likelihood === "media" ? AMBER : INK });
        if (real && f.text) w.p(`«${f.text}»`, { size: 8.5, color: "#334155" });
        if (f.summary) w.p(f.summary, { size: 8, color: MUTED });
      }
    }
    if (real && fk.suspects.length) {
      w.sub("Perfiles que parecen falsos");
      w.table(
        ["Perfil", "Riesgo", "Señales"],
        fk.suspects.slice(0, 12).map((a: any) => [a.name, `${a.level} (${a.score})`, a.signals.join(" · ")]),
        [26, 14, 60]
      );
    }
    if (!real) w.p("Revisamos de forma continua las reseñas del negocio para detectar opiniones que incumplen las normas de Google y solicitar su retirada.", { size: 8.8, color: "#334155" });
  }

  // Cierre
  w.h2(real ? "Puntos de atención y recomendaciones" : "Próximos pasos");
  for (const s of buildNextSteps(data, mode, cx)) w.bullet(s, real ? AMBER : accent);

  // Pie en todas las páginas
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const b = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fillColor(LIGHT)
      .font("R")
      .fontSize(7)
      .text(pdfText(`${data.branding?.name ? `${data.branding.name} · ` : ""}${data.client.name} · Página ${i + 1} de ${range.count}`), w.L, doc.page.height - 30, { width: w.Wd, align: "center", lineBreak: false });
    doc.page.margins.bottom = b;
  }
  doc.end();
  return done;
}
