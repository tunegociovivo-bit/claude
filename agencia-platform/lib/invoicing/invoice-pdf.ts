import PDFDocument from "pdfkit";
import { computeInvoiceLineAmounts, computeTotals, formatMoney, PAYMENT_METHOD_LABEL, TYPE_LABEL, type InvoiceType, type PaymentMethod } from "./core";
import { invoiceTaxLabel } from "./invoice-form";
import type { InvoiceForHtml, InvoiceParty } from "./invoice-html";

function partyText(party: InvoiceParty): string {
  return [
    party.legalName && party.legalName !== party.name ? party.legalName : party.name,
    party.taxId ? `NIF/CIF: ${party.taxId}` : null,
    party.address,
    [party.postalCode, party.city, party.province].filter(Boolean).join(" "),
    party.email,
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

export async function buildInvoicePdf(invoice: InvoiceForHtml): Promise<Buffer> {
  const document = new PDFDocument({ size: "A4", margin: 42, info: { Title: `${TYPE_LABEL[invoice.type as InvoiceType] ?? "Factura"} ${invoice.number ?? ""}` } });
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
  document.fillColor(accent).font("Helvetica-Bold").fontSize(20).text((TYPE_LABEL[invoice.type as InvoiceType] ?? "Factura").toUpperCase(), 330, 42, { width: 220, align: "right" });
  document.fillColor("#111827").fontSize(12).text(invoice.number ?? "(borrador)", 330, 68, { width: 220, align: "right" });
  document.font("Helvetica").fontSize(9).fillColor("#4B5563").text(partyText(invoice.issuer), 42, 112, { width: 250 });
  document.text(`Fecha: ${invoice.issueDate.toLocaleDateString("es-ES")}\n${invoice.dueDate ? `Vencimiento: ${invoice.dueDate.toLocaleDateString("es-ES")}` : ""}`, 330, 92, { width: 220, align: "right" });
  document.moveTo(42, 178).lineTo(553, 178).lineWidth(2).strokeColor(accent).stroke();
  document.fillColor("#6B7280").font("Helvetica-Bold").fontSize(8).text("FACTURAR A", 42, 195);
  document.fillColor("#111827").font("Helvetica").fontSize(10).text(partyText(invoice.client), 42, 210, { width: 300 });

  const headers = ["CONCEPTO", "DESCRIPCIÓN", "PRECIO", "UDS.", "SUBTOTAL", "IMPUESTOS", "TOTAL"];
  const widths = [78, 118, 65, 36, 65, 70, 70];
  let y = 285;
  const drawTableHeader = () => {
    document.rect(42, y, 511, 24).fill(accent);
    let headerX = 46;
    headers.forEach((header, index) => { document.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(6.5).text(header, headerX, y + 8, { width: widths[index] - 5, align: index > 1 ? "right" : "left" }); headerX += widths[index]; });
    y += 24;
  };
  drawTableHeader();
  const appendices: Array<{ concept: string; description: string }> = [];
  for (const line of invoice.lines) {
    const amounts = computeInvoiceLineAmounts(line);
    const renderedDescription = invoiceTableDescription(line.description || "");
    if (renderedDescription.appendix) appendices.push({ concept: line.concept || "Línea", description: renderedDescription.appendix });
    const values = [line.concept || line.description, renderedDescription.table || "—", formatMoney(line.unitPriceCents, invoice.currency), String(line.quantity), formatMoney(amounts.subtotalCents, invoice.currency), invoiceTaxLabel(line.taxRate, invoice.currency), formatMoney(amounts.totalCents, invoice.currency)];
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
  document.font("Helvetica").fontSize(10).fillColor("#111827").text("Base imponible", 350, y, { width: 100 }).text(formatMoney(totals.subtotalCents, invoice.currency), 450, y, { width: 103, align: "right" });
  y += 24;
  document.moveTo(350, y).lineTo(553, y).lineWidth(2).strokeColor(accent).stroke();
  document.font("Helvetica-Bold").fontSize(14).fillColor(accent).text("Total", 350, y + 7, { width: 100 }).text(formatMoney(totals.totalCents, invoice.currency), 450, y + 7, { width: 103, align: "right" });
  y += 55;
  document.roundedRect(42, y, 511, 44, 6).fill("#F3F4F6");
  document.fillColor("#6B7280").font("Helvetica-Bold").fontSize(8).text("FORMA DE PAGO", 54, y + 9);
  const paymentText = `${PAYMENT_METHOD_LABEL[invoice.paymentMethod as PaymentMethod] ?? invoice.paymentMethod}${(invoice.paymentMethod === "TRANSFER" || invoice.paymentMethod === "REMITTANCE") && invoice.issuer.iban ? ` · IBAN: ${invoice.issuer.iban}` : ""}`;
  document.fillColor("#111827").font("Helvetica").fontSize(10).text(paymentText, 54, y + 23, { width: 480 });
  document.y = y + 58;
  const writeSection = (title: string, content?: string | null) => {
    if (!content) return;
    if (document.y > 720) document.addPage();
    document.moveDown(0.6).fillColor(accent).font("Helvetica-Bold").fontSize(10).text(title, 42, document.y, { width: 511 });
    document.fillColor("#374151").font("Helvetica").fontSize(9).text(content, 42, document.y + 4, { width: 511, lineGap: 2 });
  };
  writeSection("NOTAS", invoice.notes);
  writeSection("CONDICIONES", invoice.terms);
  if (appendices.length) {
    if (document.y > 680) document.addPage();
    document.moveDown(0.8).fillColor(accent).font("Helvetica-Bold").fontSize(11).text("DETALLE COMPLETO DE CONCEPTOS", 42, document.y, { width: 511 });
    for (const appendix of appendices) writeSection(appendix.concept, appendix.description);
  }
  document.end();
  return completed;
}
