/**
 * PDFs del Detector de reseñas falsas (generados en servidor con pdfkit, sin depender de
 * window.print): informe para el cliente, informe de evidencias para Google y escrito a soporte.
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { LEVEL_HIGH, LEVEL_MEDIUM, type AnalysisResults, type Author } from "./analyzer";
import { buildGoogleCase, fallbackLetter } from "./google";
import { POLICY_CATEGORIES } from "./policy";

export type PdfKind = "cliente" | "google" | "carta";
type Brand = { agency: string; contact?: string };

const INK = "#16160F";
const GOLD = "#C9962E";
const MUTED = "#6B665A";
const RED = "#B3261E";
const AMBER = "#B26A00";

const EMOJI_NAMES: Record<string, string> = {
  "🖕": "dedo corazón", "💩": "excremento", "🤮": "vomitando", "🤢": "náuseas", "🤬": "insultando", "🤡": "payaso",
  "🐀": "rata", "🐷": "cerdo", "🐖": "cerdo", "🐽": "cerdo", "🗑": "basura", "🚮": "basura", "👎": "pulgar abajo", "😡": "enfadado", "😠": "enfadado"
};

/** Las fuentes del PDF no incluyen emojis: se sustituyen por su descripción. */
export function pdfText(s: string): string {
  return String(s ?? "")
    .replace(/\p{Extended_Pictographic}(️|\p{Emoji_Modifier})?/gu, (m) => {
      const base = [...m][0];
      return `[emoji: ${EMOJI_NAMES[base] ?? "icono"}]`;
    })
    .replace(/[​-‍️]/g, "")
    .replace(/★/g, "*");
}

const fdate = (d?: string) => (d ? d.split("-").reverse().join("/") : "—");
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d).replace(".", ","));

function fonts(doc: PDFKit.PDFDocument) {
  const dir = path.join(process.cwd(), "public", "fonts");
  try {
    const reg = fs.readFileSync(path.join(dir, "Inter-Regular.ttf"));
    const bold = fs.readFileSync(path.join(dir, "Inter-Bold.ttf"));
    doc.registerFont("R", reg);
    doc.registerFont("B", bold);
  } catch {
    doc.registerFont("R", "Helvetica");
    doc.registerFont("B", "Helvetica-Bold");
  }
}

class Writer {
  doc: PDFKit.PDFDocument;
  left = 48;
  width: number;
  constructor(doc: PDFKit.PDFDocument) {
    this.doc = doc;
    this.width = doc.page.width - 96;
  }
  ensure(h: number) {
    if (this.doc.y + h > this.doc.page.height - 60) this.doc.addPage();
  }
  cover(eyebrow: string, title: string, subtitle: string, meta: string, agency: string) {
    const d = this.doc;
    d.rect(0, 0, d.page.width, 150).fill(INK);
    d.fillColor(GOLD).font("B").fontSize(10).text(agency.toUpperCase(), this.left, 36, { width: this.width, characterSpacing: 1 });
    d.fillColor(GOLD).font("R").fontSize(8.5).text(eyebrow.toUpperCase(), this.left, 60, { width: this.width, characterSpacing: 0.8 });
    d.fillColor("#FFFFFF").font("B").fontSize(19).text(pdfText(title), this.left, 74, { width: this.width });
    d.fillColor("#FFFFFF").font("R").fontSize(12).text(pdfText(subtitle), this.left, d.y + 2, { width: this.width });
    d.fillColor("#CFC8B6").fontSize(8.5).text(pdfText(meta), this.left, d.y + 4, { width: this.width });
    d.y = 170;
    d.fillColor(INK);
  }
  h2(t: string) {
    this.ensure(50);
    const d = this.doc;
    d.moveDown(0.6);
    d.fillColor(INK).font("B").fontSize(13).text(pdfText(t), this.left, d.y, { width: this.width });
    const y = d.y + 3;
    d.moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(1.5).strokeColor(GOLD).stroke();
    d.y = y + 8;
  }
  h3(t: string, color = INK) {
    this.ensure(30);
    this.doc.fillColor(color).font("B").fontSize(10.5).text(pdfText(t), this.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.2);
  }
  p(t: string, opts: { size?: number; color?: string; bold?: boolean; indent?: number } = {}) {
    const d = this.doc;
    d.fillColor(opts.color ?? INK).font(opts.bold ? "B" : "R").fontSize(opts.size ?? 9.5);
    const w = this.width - (opts.indent ?? 0);
    this.ensure(d.heightOfString(pdfText(t), { width: w }) + 4);
    d.text(pdfText(t), this.left + (opts.indent ?? 0), d.y, { width: w, lineGap: 1.5 });
    d.moveDown(0.25);
  }
  bullets(items: string[], size = 9.5) {
    for (const it of items) this.p(`•  ${it}`, { size, indent: 6 });
  }
  kv(rows: [string, string][]) {
    for (const [k, v] of rows) {
      const d = this.doc;
      this.ensure(16);
      d.font("R").fontSize(8.5);
      const hk = d.heightOfString(pdfText(k), { width: 150 });
      d.fontSize(9);
      const hv = d.heightOfString(pdfText(v || "—"), { width: this.width - 160 });
      this.ensure(Math.max(hk, hv) + 4);
      const y = d.y;
      d.fillColor(MUTED).font("R").fontSize(8.5).text(pdfText(k), this.left, y, { width: 150 });
      d.fillColor(INK).font("R").fontSize(9).text(pdfText(v || "—"), this.left + 160, y, { width: this.width - 160 });
      d.y = y + Math.max(hk, hv, 11) + 4;
    }
  }
  review(label: string, r: { rating: number; date: string; text: string; link?: string }, color: string) {
    const d = this.doc;
    const text = pdfText(r.text?.trim() ? `«${r.text}»` : "(sin texto)");
    const w = this.width - 14;
    d.font("R").fontSize(9);
    const h = 16 + d.heightOfString(text, { width: w }) + (r.link ? 12 : 0) + 6;
    this.ensure(h + 4);
    const y0 = d.y;
    d.rect(this.left, y0, this.width, h).fill("#F7F2E7");
    d.rect(this.left, y0, 3, h).fill(color);
    d.fillColor(INK).font("B").fontSize(8.5).text(pdfText(`${label} · ${r.rating}/5 · ${fdate(r.date)}`), this.left + 10, y0 + 5, { width: w });
    d.fillColor(INK).font("R").fontSize(9).text(text, this.left + 10, d.y + 2, { width: w, lineGap: 1 });
    if (r.link) d.fillColor("#8a6414").fontSize(7.5).text(r.link, this.left + 10, d.y + 2, { width: w, link: r.link, underline: true });
    d.y = y0 + h + 5;
  }
  footer(agency: string) {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      // Escribir por debajo del margen inferior no debe crear páginas nuevas.
      const bottom = d.page.margins.bottom;
      d.page.margins.bottom = 0;
      d.fillColor(MUTED).font("R").fontSize(7.5).text(`${agency} · Página ${i + 1} de ${range.count}`, this.left, d.page.height - 36, { width: this.width, align: "center", lineBreak: false });
      d.page.margins.bottom = bottom;
    }
  }
}

function authorBlock(w: Writer, a: Author, n: number, res: AnalysisResults) {
  w.ensure(90);
  const levelColor = a.level === "alto" ? RED : a.level === "medio" ? AMBER : MUTED;
  w.h3(`#${n}  ${a.name}  —  riesgo ${a.level} (${a.score}/100)`, levelColor);
  w.p(`${a.totalReviews} reseñas en total${a.localGuide ? " · Local Guide" : ""}${a.link ? ` · Perfil: ${a.link}` : ""}`, { size: 8.5, color: MUTED });
  for (const r of a.clientReviews) w.review(`Reseña a ${res.client.title}`, r, RED);
  for (const c of a.compReviews) w.review(`Reseña a ${res.competitors[c.comp ?? 0]?.title ?? c.title ?? "competidor"}`, c, GOLD);
  w.p("Señales detectadas:", { size: 8.5, bold: true });
  w.bullets(a.signals.map((s) => `${s.points > 0 ? "+" : ""}${s.points}  ${s.label}${s.detail ? ` (${s.detail})` : ""}`), 8.5);
  w.doc.moveDown(0.4);
}

function policySection(w: Writer, res: AnalysisResults, onlyStrong: boolean) {
  const all = res.policy?.findings ?? [];
  const list = onlyStrong ? all.filter((f) => f.likelihood !== "baja") : all;
  w.p(
    `Se ha revisado el texto de ${res.policy?.checked ?? 0} reseñas negativas ${res.policy?.aiUsed ? "con reglas automáticas e inteligencia artificial" : "con reglas automáticas"} frente a la política de contenido prohibido y restringido de Google Maps. ${list.length} presentan incumplimientos${onlyStrong ? " claros o con indicios razonables" : ""}.`
  );
  list.forEach((f, i) => {
    w.ensure(80);
    w.h3(`${i + 1}. ${f.author || "Usuario de Google"} — probabilidad de retirada: ${f.likelihood}`, f.likelihood === "alta" ? RED : AMBER);
    w.review("Reseña", f, RED);
    for (const v of f.violations) {
      w.p(`${POLICY_CATEGORIES[v.category].google}: «${v.evidence}» — ${v.explanation}`, { size: 8.5, indent: 6 });
    }
    if (f.authorLink) w.p(`Perfil del autor: ${f.authorLink}`, { size: 8, color: MUTED, indent: 6 });
  });
}

export async function buildFakeReviewPdf(kind: PdfKind, res: AnalysisResults, brand: Brand): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `Reseñas — ${res.client.title}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(Buffer.from(c)));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  fonts(doc);
  const w = new Writer(doc);
  const gc = buildGoogleCase(res);
  const today = new Date().toLocaleDateString("es-ES");
  const period = res.params.dateFrom ? `desde ${fdate(res.params.dateFrom)}` : "todo el histórico";

  if (kind === "cliente") {
    w.cover("Informe de reputación · Google Business Profile", res.mode === "policy" ? "Revisión de reseñas negativas" : "Análisis de reseñas negativas sospechosas", res.client.title, `Fecha: ${today} · Periodo: ${period} · Reseñas negativas: <= ${res.params.negThreshold} estrellas`, brand.agency);
    w.h2("Resumen");
    const kp: [string, string][] = [["Reseñas negativas analizadas", String(res.stats.clientNeg)]];
    if (res.mode !== "policy") {
      kp.push(["Perfiles que valoraron bien a la competencia", String(res.stats.authorsCrossPos)]);
      kp.push(["Perfiles de riesgo alto / medio", `${res.stats.high} / ${res.stats.medium}`]);
      if (res.impact.client) kp.push(["Nota sin reseñas sospechosas", `${num(res.impact.client.current)} → ${num(res.impact.client.without, 2)}`]);
    }
    if (res.policy) kp.push(["Reseñas que incumplen las políticas de Google", String(res.policy.findings.filter((f) => f.likelihood !== "baja").length)]);
    kp.push(["Reseñas cuya retirada se puede solicitar", String(gc.removals.length)]);
    w.kv(kp);
    if (res.aiSummary) {
      w.h2("Resumen ejecutivo");
      for (const para of res.aiSummary.split(/\n\s*\n/)) w.p(para);
    }
    w.h2("Hallazgos");
    w.bullets(res.findings);
    if (res.mode !== "policy") {
      w.h2("Fichas analizadas");
      w.kv([
        ["Cliente", `${res.client.title} · ${res.client.address} · ${num(res.client.rating)} (${res.client.reviews ?? "?"} reseñas)`],
        ...res.competitors.map((c, i) => [`Competidor ${i + 1}`, `${c.title} · ${c.address} · ${num(c.rating)} (${c.reviews ?? "?"} reseñas)`] as [string, string])
      ]);
      if (res.discovery?.candidates.length) {
        w.h2(res.discovery.mode === "auto" ? "Competencia detectada automáticamente" : "Otros negocios con autores en común");
        w.bullets(
          res.discovery.candidates.slice(0, 12).map((c) => `${c.title}: ${c.count} perfiles en común${c.sameSector ? ", mismo sector" : ""}${c.km != null ? `, ${num(c.km)} km` : ""}${c.selected ? " (analizado)" : ""}`),
          9
        );
      }
      const sus = res.authors.filter((a) => a.level !== "bajo");
      w.h2(`Perfiles sospechosos (${sus.length})`);
      if (!sus.length) w.p("No se han encontrado perfiles con riesgo medio o alto.");
      sus.forEach((a, i) => authorBlock(w, a, i + 1, res));
    }
    if (res.policy) {
      w.h2("Reseñas que incumplen las políticas de Google");
      policySection(w, res, false);
    }
    w.h2("Metodología y limitaciones");
    w.p(
      `Se han analizado las reseñas públicas de Google Maps. Cada perfil recibe una puntuación de 0 a 100 a partir de señales objetivas (valoración positiva a la competencia, proximidad temporal, actividad del perfil, cuenta nueva, textos casi idénticos, ataques a otros negocios del sector…). Riesgo alto: >= ${LEVEL_HIGH}; medio: ${LEVEL_MEDIUM}-${LEVEL_HIGH - 1}.`
    );
    w.p(
      "Las señales son indicios estadísticos y patrones compatibles con reseñas no auténticas; no prueban por sí mismas la falsedad de una reseña ni la autoría de terceros. Las fechas relativas de Google son aproximadas. Datos públicos tratados con la finalidad legítima de defensa de la reputación del cliente.",
      { size: 8.5, color: MUTED }
    );
  }

  if (kind === "google") {
    w.cover("Solicitud de revisión de reseñas · Informe de evidencias", "Reseñas que incumplen las políticas de Google Maps", res.client.title, `Fecha: ${today} · Ficha: ${res.client.mapsUrl}`, brand.agency);
    w.h2("Negocio afectado");
    w.kv([
      ["Nombre", res.client.title],
      ["Dirección", res.client.address],
      ["Categoría", res.client.type],
      ["Enlace a la ficha", res.client.mapsUrl],
      ...(res.client.placeId ? [["Place ID", res.client.placeId] as [string, string]] : []),
      ["Presentado por", `${brand.agency}${brand.contact ? ` (${brand.contact})` : ""}, en nombre del titular`]
    ]);
    w.h2("Resumen");
    w.bullets([
      `Reseñas negativas analizadas: ${res.stats.clientNeg} (periodo: ${period}).`,
      `Perfiles con patrón de interacción falsa (negativa a este negocio y positiva a competidores directos): ${gc.fakeProfiles.length}.`,
      `Reseñas con contenido prohibido o restringido: ${gc.policyReviews.length}.`,
      `Total de reseñas cuya retirada se solicita: ${gc.removals.length}.`
    ]);
    if (gc.fakeProfiles.length) {
      w.h2("A. Perfiles con patrón de interacción falsa / conflicto de intereses");
      w.p(
        "Los siguientes perfiles publicaron una valoración negativa de este negocio y, además, valoraciones positivas de negocios competidores directos de la misma zona y sector, en muchos casos en fechas muy próximas. Este patrón es compatible con reseñas publicadas para alterar la puntuación de las fichas (política de contenido falso e interacción falsa y de conflicto de intereses).",
        { size: 9 }
      );
      gc.fakeProfiles.forEach((a, i) => authorBlock(w, a, i + 1, res));
    }
    if (gc.policyReviews.length) {
      w.h2("B. Reseñas con contenido prohibido o restringido");
      policySection(w, res, true);
    }
    w.h2("Anexo · Enlaces de las reseñas cuya retirada se solicita");
    gc.removals.forEach((r, i) => w.p(`${i + 1}. ${r.author} · ${r.rating}/5 · ${fdate(r.date)} · ${r.policies.join("; ")}${r.link ? `\n    ${r.link}` : ""}`, { size: 8.5 }));
  }

  if (kind === "carta") {
    const text = res.letter?.text?.trim() || fallbackLetter(res, gc, brand);
    doc.fillColor(INK).font("B").fontSize(9).text(brand.agency.toUpperCase(), w.left, 48, { width: w.width, characterSpacing: 1 });
    doc.moveDown(1.2);
    for (const para of text.split(/\n/)) {
      if (!para.trim()) {
        doc.moveDown(0.5);
        continue;
      }
      const isSubject = /^asunto:/i.test(para.trim());
      w.p(para, { size: isSubject ? 10.5 : 10, bold: isSubject });
    }
  }

  w.footer(brand.agency);
  doc.end();
  return done;
}
