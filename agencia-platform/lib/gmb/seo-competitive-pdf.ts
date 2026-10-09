/** PDF del informe SEO competitivo (pdfkit, en servidor). */
import PDFDocument from "pdfkit";
import { pdfText } from "@/lib/gmb/fake-reviews/pdf";
import { fonts, W } from "@/lib/gmb/client-report-pdf";
import type { SeoCompetitiveReport } from "@/lib/gmb/seo-competitive";

const MUTED = "#64748B";
const LIGHT = "#94A3B8";
const RED = "#E11D48";
const AMBER = "#D97706";
const GREEN = "#059669";

const n = (v: number | null | undefined, d = 0) => (v == null ? "–" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: d }).format(v));
const yn = (b: boolean | null | undefined) => (b == null ? "–" : b ? "Sí" : "No");

export async function buildSeoReportPdf(r: SeoCompetitiveReport, clientName: string, brand: { agency: string; color: string | null }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margins: { top: 48, bottom: 40, left: 44, right: 44 }, bufferPages: true, info: { Title: `Informe SEO ${clientName}` } });
  fonts(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const accent = brand.color || "#2563EB";
  const w = new W(doc, accent);

  doc.rect(0, 0, doc.page.width, 118).fill(accent);
  doc.fillColor("#FFFFFF").font("B").fontSize(8.5).text("INFORME SEO LOCAL COMPETITIVO", w.L, 28, { characterSpacing: 0.8 });
  doc.font("B").fontSize(19).text(pdfText(clientName), w.L, 42, { width: w.Wd - 120 });
  doc.font("R").fontSize(9.5).text(pdfText(`Búsqueda: «${r.keyword}» · desde ${r.origin}`), w.L, doc.y + 3, { width: w.Wd - 120 });
  doc.font("R").fontSize(8.5).text(new Date(r.generatedAt).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }), w.L, doc.y + 2);
  doc.font("B").fontSize(26).text(r.yourPosition ? `#${r.yourPosition}` : "–", w.L, 36, { width: w.Wd, align: "right" });
  doc.font("R").fontSize(8.5).text(r.yourPosition ? "posición actual en Google Maps" : `no aparece en los ${r.totalResults} primeros`, w.L, 70, { width: w.Wd, align: "right" });
  doc.y = 136;

  w.h2("Puntuación frente a los mejor posicionados");
  w.cards(
    [
      { label: "SEO local", value: `${r.scores.total}/100`, sub: "frente al top 3" },
      { label: "Relevancia", value: `${r.scores.relevance}/100`, sub: "categorías y palabra clave" },
      { label: "Prominencia", value: `${r.scores.prominence}/100`, sub: "reseñas, menciones y enlaces" },
      { label: "Calidad", value: `${r.scores.quality}/100`, sub: "ficha y web" }
    ],
    4
  );
  if (r.aiSummary) {
    w.sub("Diagnóstico");
    w.p(r.aiSummary, { size: 9.3 });
  }

  w.h2("Comparativa con la competencia");
  const rows = [...r.competitors, r.you].sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  w.table(
    ["Pos.", "Negocio", "Nota", "Reseñas", "Res./mes", "Fotos", "Web", "KW nombre", "Menc.", "Km"],
    rows.map((c) => [
      c.position ? String(c.position) : "–",
      `${c.name}${c.isYou ? "  (TÚ)" : ""}`,
      n(c.rating, 1),
      n(c.reviews),
      n(c.reviewsPerMonth, 1),
      c.photos == null ? "–" : c.photos >= 10 && !c.isYou ? "10+" : n(c.photos),
      yn(c.hasWebsite),
      yn(c.keywordInName),
      n(c.mentions),
      n(c.distanceKm, 1)
    ]),
    [5, 30, 6, 8, 8, 6, 6, 9, 9, 6],
    ["left", "left", "right", "right", "right", "right", "left", "left", "right", "right"]
  );
  w.p(`Media del top 3: nota ${n(r.top3.rating, 1)} · ${n(r.top3.reviews)} reseñas · ${n(r.top3.reviewsPerMonth, 1)} reseñas/mes · ${n(r.top3.mentions, 1)} webs que les mencionan.`, { size: 8.5, color: MUTED });

  w.h2("Webs de la competencia");
  w.table(
    ["Negocio", "HTTPS", "KW en título", "KW en H1", "Schema", "Teléfono", "Palabras", "Enlaces*"],
    rows
      .filter((c) => c.web)
      .map((c) => [
        `${c.name}${c.isYou ? " (TÚ)" : ""}`,
        yn(c.web?.https),
        yn(c.web?.keywordInTitle),
        yn(c.web?.keywordInH1),
        yn(c.web?.localBusinessSchema),
        yn(c.web?.phoneInContent),
        n(c.web?.words),
        n(c.domainMentions)
      ]),
    [34, 8, 11, 10, 9, 10, 9, 9],
    ["left", "left", "left", "left", "left", "left", "right", "right"]
  );
  w.p("* Webs distintas que mencionan o enlazan el dominio (estimación por búsqueda en Google).", { size: 7.5, color: LIGHT });

  const dirs = new Map<string, number>();
  for (const c of r.competitors.slice(0, 5)) for (const d of c.directories) dirs.set(d, (dirs.get(d) ?? 0) + 1);
  if (dirs.size) {
    w.sub("Directorios donde aparece la competencia");
    const mine = new Set(r.you.directories);
    w.p(
      [...dirs.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([d, k]) => `${d} (${k})${mine.has(d) ? " [también tú]" : ""}`)
        .join(" · "),
      { size: 8.8 }
    );
    w.p("Entre paréntesis, cuántos de los 5 primeros aparecen en cada directorio.", { size: 7.5, color: LIGHT });
  }

  if (r.gaps.length) {
    w.h2("Brechas frente al top 3");
    w.table(
      ["Área", "Factor", "Tú", "Top 3", "Prioridad"],
      r.gaps.map((g) => [g.area, g.label, g.you, g.top3, g.severity]),
      [14, 40, 14, 18, 14]
    );
  }

  w.h2("Plan de acción para mejorar el posicionamiento");
  for (const a of r.actions) {
    w.p(`${a.priority}. [${a.area} · impacto ${a.impact}] ${a.action}`, { bold: true, size: 9.2, color: a.impact === "alto" ? RED : a.impact === "medio" ? AMBER : GREEN });
    w.p(a.why, { size: 8.5, color: MUTED });
  }

  w.h2("Datos de la ficha");
  w.p(
    `Fotos: ${n(r.own.photos)} · Publicaciones en 30 días: ${n(r.own.postsLast30)} · Descripción: ${n(r.own.descriptionLength)} caracteres · Categorías secundarias: ${n(r.own.additionalCategories)} · Citaciones registradas: ${r.own.citations.total} (${r.own.citations.published} publicadas, ${r.own.citations.inconsistent} inconsistentes).`,
    { size: 8.8 }
  );
  if (r.warnings.length) w.p(`Limitaciones de este informe: ${r.warnings.join(" ")}`, { size: 7.8, color: LIGHT });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const b = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(LIGHT).font("R").fontSize(7).text(pdfText(`${brand.agency ? `${brand.agency} · ` : ""}Informe SEO · ${clientName} · Página ${i + 1} de ${range.count}`), w.L, doc.page.height - 30, { width: w.Wd, align: "center", lineBreak: false });
    doc.page.margins.bottom = b;
  }
  doc.end();
  return done;
}
