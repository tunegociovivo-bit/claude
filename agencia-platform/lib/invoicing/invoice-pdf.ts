import PDFDocument from "pdfkit";
import { computeInvoiceLineAmounts, computeTotals, formatMoney } from "./core";
import { invoiceTaxLabel } from "./invoice-form";
import type { InvoiceForHtml, InvoiceParty } from "./invoice-html";
import { invoiceLabels, invoiceLanguage, localizedDate, localizedPaymentLabel, localizedTypeLabel, type InvoiceLanguage } from "./invoice-locale";

export function invoicePartyText(party: InvoiceParty, language: InvoiceLanguage): string {
  return [
    party.legalName && party.legalName !== party.name ? party.legalName : party.name,
    party.taxId ? `${invoiceLabels(language).taxId}: ${party.taxId}` : null,
    party.address,
    [party.postalCode, party.city, party.province].filter(Boolean).join(" "),
    party.phone
  ].filter(Boolean).join("\n");
}

function imageBuffer(value?: string | null): Buffer | null {
  const match = value?.match(/^data:image\/(?:png|jpeg|webp);base64,(.+)$/i);
  return match ? Buffer.from(match[1], "base64") : null;
}

export function invoiceTableDescription(description: string): { table: string; appendix: string | null } {
  if (description.length <= 400) return { table: description, appendix: null };
  return { table: `${description.slice(0, 360).trimEnd()}… (ver detalle completo)`, appendix: description };
}

export function invoicePdfTableLayout(language: InvoiceLanguage): Array<{ label: string; width: number }> {
  const labels = invoiceLabels(language);
  const headers = [labels.concept, labels.description, labels.unitPrice, labels.quantity, labels.subtotal, labels.taxes, labels.total];
  const widths = [72, 110, 65, 48, 65, 70, 72];
  return headers.map((label, index) => ({ label: label.toUpperCase(), width: widths[index] }));
}

export function invoicePdfHeaderFits(label: string, width: number, fontSize = 6.5): boolean {
  const measurement = new PDFDocument({ autoFirstPage: false });
  measurement.font("Helvetica-Bold").fontSize(fontSize);
  const fits = measurement.widthOfString(label) <= width - 8;
  measurement.end();
  return fits;
}

export async function buildInvoicePdf(invoice: InvoiceForHtml): Promise<Buffer> {
  const language = invoiceLanguage(invoice);
  const labels = invoiceLabels(language);
  const typeLabel = localizedTypeLabel(invoice.type, language);
  const document = new PDFDocument({ size: "A4", margin: 42, info: { Title: `${typeLabel} ${invoice.number ?? ""}` } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const accent = "#2563EB";
  const logo = imageBuffer(invoice.issuer.logoUrl);
  let logoDrawn = false;
  if (logo) {
    try { document.image(logo, 42, 38, { fit: [150, 70] }); logoDrawn = true; } catch { logoDrawn = false; }
  }
  if (!logoDrawn) document.fillColor(accent).font("Helvetica-Bold").fontSize(18).text(invoice.issuer.name ?? "", 42, 42, { width: 260 });
  document.fillColor(accent).font("Helvetica-Bold").fontSize(20).text(typeLabel.toUpperCase(), 330, 42, { width: 220, align: "right" });
  document.fillColor("#111827").fontSize(12).text(invoice.number ?? (language === "en" ? "(draft)" : "(borrador)"), 330, 68, { width: 220, align: "right" });
  document.font("Helvetica").fontSize(9).fillColor("#4B5563").text(invoicePartyText(invoice.issuer, language), 42, 112, { width: 250 });
  document.text(`${labels.issueDate}: ${localizedDate(invoice.issueDate, language)}\n${invoice.dueDate ? `${labels.dueDate}: ${localizedDate(invoice.dueDate, language)}` : ""}`, 330, 92, { width: 220, align: "right" });
  document.moveTo(42, 178).lineTo(553, 178).lineWidth(2).strokeColor(accent).stroke();
  document.fillColor("#6B7280").font("Helvetica-Bold").fontSize(8).text(labels.billTo.toUpperCase(), 42, 195);
  document.fillColor("#111827").font("Helvetica").fontSize(10).text(invoicePartyText(invoice.client, language), 42, 210, { width: 300 });

  const columns = invoicePdfTableLayout(language);
  const widths = columns.map((column) => column.width);
  let y = 285;
  const drawTableHeader = () => {
    document.rect(42, y, 511, 24).fill(accent);
    let headerX = 46;
    columns.forEach((column, index) => { document.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(6.5).text(column.label, headerX, y + 8, { width: widths[index] - 5, align: index > 1 ? "right" : "left", lineBreak: false }); headerX += widths[index]; });
    y += 24;
  };
  drawTableHeader();
  const appendices: Array<{ concept: string; description: string }> = [];
  for (const line of invoice.lines) {
    const amounts = computeInvoiceLineAmounts(line);
    const renderedDescription = invoiceTableDescription(line.description || "");
    if (renderedDescription.appendix) appendices.push({ concept: line.concept || labels.line, description: renderedDescription.appendix });
    const values = [line.concept || renderedDescription.table || labels.line, renderedDescription.table || "—", formatMoney(line.unitPriceCents, invoice.currency), String(line.quantity), formatMoney(amounts.subtotalCents, invoice.currency), invoiceTaxLabel(line.taxRate, invoice.currency), formatMoney(amounts.totalCents, invoice.currency)];
    document.font("Helvetica").fontSize(7.5);
    const rowHeight = Math.max(30, ...values.map((value, index) => document.heightOfString(String(value), { width: widths[index] - 7 }) + 14));
    if (y + rowHeight > 760) { document.addPage(); y = 42; drawTableHeader(); }
    let x = 46;
    values.forEach((value, index) => { document.fillColor("#111827").font(index === 0 || index === 6 ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).text(String(value), x, y + 7, { width: widths[index] - 7, align: index > 1 ? "right" : "left" }); x += widths[index]; });
    document.moveTo(42, y + rowHeight).lineTo(553, y + rowHeight).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
    y += rowHeight;
  }
  const totals = computeTotals(invoice.lines);
  y += 14;
  if (y + 125 > 790) { document.addPage(); y = 54; }
  document.font("Helvetica").fontSize(10).fillColor("#111827").text(labels.taxableBase, 350, y, { width: 100 }).text(formatMoney(totals.subtotalCents, invoice.currency), 450, y, { width: 103, align: "right" });
  y += 24;
  document.moveTo(350, y).lineTo(553, y).lineWidth(2).strokeColor(accent).stroke();
  document.font("Helvetica-Bold").fontSize(14).fillColor(accent).text(labels.total, 350, y + 7, { width: 100 }).text(formatMoney(totals.totalCents, invoice.currency), 450, y + 7, { width: 103, align: "right" });
  y += 55;
  document.roundedRect(42, y, 511, 44, 6).fill("#F3F4F6");
  document.fillColor("#6B7280").font("Helvetica-Bold").fontSize(8).text(labels.paymentMethod.toUpperCase(), 54, y + 9);
  const paymentText = `${localizedPaymentLabel(invoice.paymentMethod, language)}${(invoice.paymentMethod === "TRANSFER" || invoice.paymentMethod === "REMITTANCE") && invoice.issuer.iban ? ` · IBAN: ${invoice.issuer.iban}` : ""}`;
  document.fillColor("#111827").font("Helvetica").fontSize(10).text(paymentText, 54, y + 23, { width: 480 });
  document.y = y + 58;
  const writeSection = (title: string, content?: string | null) => {
    if (!content) return;
    if (document.y > 720) document.addPage();
    document.moveDown(0.6).fillColor(accent).font("Helvetica-Bold").fontSize(10).text(title, 42, document.y, { width: 511 });
    document.fillColor("#374151").font("Helvetica").fontSize(9).text(content, 42, document.y + 4, { width: 511, lineGap: 2 });
  };
  writeSection(labels.notes.toUpperCase(), invoice.notes);
  writeSection(labels.terms.toUpperCase(), invoice.terms);
  if (appendices.length) {
    if (document.y > 680) document.addPage();
    document.moveDown(0.8).fillColor(accent).font("Helvetica-Bold").fontSize(11).text(labels.fullDetail, 42, document.y, { width: 511 });
    for (const appendix of appendices) writeSection(appendix.concept, appendix.description);
  }
  document.end();
  return completed;
}
