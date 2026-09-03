import PDFDocument from "pdfkit";

type Item = { clientName: string; source: string; status: string; invoiceCount: number; amountCents: number; currency: string; invoiceDetails: unknown; error: string | null };
const labels: Record<string, string> = { HOLDED: "Holded", META: "Meta", GOOGLE_ADS: "Google Ads", BANK: "Banco" };
const money = (cents: number, currency = "EUR") => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);

export async function buildAccountancyReport(periodKey: string, items: Item[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Facturas gestoría ${periodKey}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  doc.rect(0, 0, 595, 125).fill("#0f172a");
  doc.fillColor("#ffffff").fontSize(24).font("Helvetica-Bold").text("Facturas para gestoría", 48, 42);
  doc.fontSize(12).font("Helvetica").fillColor("#cbd5e1").text(`Resumen mensual · ${periodKey}`, 48, 78);
  doc.fillColor("#0f172a").fontSize(11).text(`Total descargado: ${items.reduce((sum, item) => sum + item.invoiceCount, 0)} facturas`, 48, 150);
  doc.text(`Importe acumulado: ${money(items.reduce((sum, item) => sum + item.amountCents, 0))}`, 48, 168);
  let y = 205;
  for (const item of items) {
    if (y > 700) { doc.addPage(); y = 48; }
    const ok = item.status === "DOWNLOADED";
    doc.roundedRect(48, y, 499, 30, 5).fill(ok ? "#ecfdf5" : "#fef2f2");
    doc.fillColor(ok ? "#047857" : "#b91c1c").font("Helvetica-Bold").fontSize(10).text(`${ok ? "DESCARGADO" : "INCIDENCIA"} · ${labels[item.source] || item.source}`, 60, y + 10);
    y += 40;
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text(item.clientName, 48, y);
    doc.font("Helvetica").fontSize(10).fillColor("#475569").text(`${item.invoiceCount} facturas · ${money(item.amountCents, item.currency)}`, 350, y, { width: 197, align: "right" });
    y += 22;
    const details = Array.isArray(item.invoiceDetails) ? item.invoiceDetails as any[] : [];
    for (const detail of details) {
      if (y > 745) { doc.addPage(); y = 48; }
      const business = detail.business ? `${detail.business} · ` : "";
      doc.fillColor("#334155").fontSize(9).text(`${business}${detail.number || "Factura"}  ${detail.date || ""}`, 60, y, { width: 330 });
      doc.text(money(Number(detail.amountCents || 0), detail.currency || item.currency), 410, y, { width: 125, align: "right" });
      y += 15;
    }
    if (item.error) { doc.fillColor("#b91c1c").fontSize(9).text(item.error, 60, y, { width: 475 }); y += 24; }
    y += 12;
  }
  if (y > 690) { doc.addPage(); y = 48; }
  doc.roundedRect(48, y, 499, 74, 6).fill("#fff7ed");
  doc.fillColor("#9a3412").font("Helvetica-Bold").fontSize(11).text("Notas pendientes", 60, y + 13);
  doc.font("Helvetica").fontSize(10).text("• Falta por descargar las facturas de Eroski de Meta.\n• Falta incorporar las cuentas y extractos bancarios.", 60, y + 33);
  doc.end();
  return done;
}
