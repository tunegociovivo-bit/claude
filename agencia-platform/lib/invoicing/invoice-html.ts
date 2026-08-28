import {
  computeTotals,
  computeInvoiceLineAmounts,
  formatMoney,
  TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  type InvoiceLine,
  type InvoiceType,
  type PaymentMethod
} from "./core";
import { invoiceTaxLabel } from "./invoice-form";

export type InvoiceParty = {
  name?: string | null;
  legalName?: string | null;
  taxId?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  countryCode?: string | null;
  email?: string | null;
  phone?: string | null;
  web?: string | null;
  iban?: string | null;
  logoUrl?: string | null;
};

export type InvoiceForHtml = {
  type: string;
  status: string;
  number?: string | null;
  issueDate: Date;
  dueDate?: Date | null;
  currency: string;
  paymentMethod: string;
  lines: InvoiceLine[];
  notes?: string | null;
  terms?: string | null;
  issuer: InvoiceParty;
  client: InvoiceParty;
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function partyLines(p: InvoiceParty): string {
  const out: string[] = [];
  if (p.legalName && p.legalName !== p.name) out.push(esc(p.legalName));
  if (p.taxId) out.push(`NIF/CIF: ${esc(p.taxId)}`);
  if (p.address) out.push(esc(p.address).replace(/\r?\n/g, "<br>"));
  const loc = [p.postalCode, p.city, p.province].filter(Boolean).join(" ");
  if (loc) out.push(esc(loc));
  if (p.email) out.push(esc(p.email));
  if (p.phone) out.push(esc(p.phone));
  return out.map((l) => `<div>${l}</div>`).join("");
}

function fmtDate(d?: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Genera el HTML de una factura/presupuesto profesional, optimizado para
 * A4 (el usuario hace Imprimir → Guardar como PDF). Diseño limpio con
 * acento de color, logo del emisor, tabla de líneas y desglose de IVA.
 */
export function buildInvoiceHtml(inv: InvoiceForHtml, opts?: { accent?: string; autoprint?: boolean }): string {
  const accent = opts?.accent ?? "#2563EB";
  const totals = computeTotals(inv.lines);
  const cur = inv.currency || "EUR";
  const typeLabel = TYPE_LABEL[inv.type as InvoiceType] ?? "Factura";
  const isDraft = inv.status === "DRAFT";
  const watermark =
    inv.type === "PROFORMA" ? "PROFORMA" : inv.type === "PRESUPUESTO" ? "PRESUPUESTO" : isDraft ? "BORRADOR" : "";

  const lineRows = inv.lines
    .map((ln) => {
      const qty = Number(ln.quantity) || 0;
      const amounts = computeInvoiceLineAmounts(ln);
      return `<tr>
        <td class="concept">${esc(ln.concept || ln.description)}</td>
        <td class="description">${esc(ln.description || "—")}</td>
        <td class="num">${formatMoney(ln.unitPriceCents, cur)}</td>
        <td class="num">${qty.toLocaleString("es-ES")}</td>
        <td class="num">${formatMoney(amounts.subtotalCents, cur)}</td>
        <td class="num">${invoiceTaxLabel(Number(ln.taxRate) || 0, cur)}<br><span class="muted">${formatMoney(amounts.taxCents, cur)}</span></td>
        <td class="num">${formatMoney(amounts.totalCents, cur)}</td>
      </tr>`;
    })
    .join("");

  const taxRows = totals.taxBreakdown
    .map(
      (t) =>
        `<tr><td>${invoiceTaxLabel(t.rate, cur)} sobre ${formatMoney(t.baseCents, cur)}</td><td class="num">${formatMoney(
          t.taxCents,
          cur
        )}</td></tr>`
    )
    .join("");

  const payExtra =
    (inv.paymentMethod === "TRANSFER" || inv.paymentMethod === "REMITTANCE") && inv.issuer.iban
      ? `<div class="muted">IBAN: ${esc(inv.issuer.iban)}</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${esc(typeLabel)} ${esc(inv.number ?? "")}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 0; font-size: 12px; line-height: 1.45; }
  .sheet { max-width: 720px; margin: 0 auto; padding: 8px; position: relative; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 3px solid ${accent}; padding-bottom: 16px; }
  .logo { max-height: 64px; max-width: 220px; object-fit: contain; }
  .brandname { font-size: 18px; font-weight: 700; color: ${accent}; }
  .doc-meta { text-align: right; }
  .doc-title { font-size: 22px; font-weight: 800; letter-spacing: .5px; color: ${accent}; text-transform: uppercase; }
  .doc-number { font-size: 14px; font-weight: 700; margin-top: 2px; }
  .doc-dates { margin-top: 6px; color: #4b5563; font-size: 11px; }
  .parties { display: flex; gap: 24px; margin-top: 20px; }
  .party { flex: 1; }
  .party h3 { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #6b7280; }
  .party .pname { font-weight: 700; font-size: 13px; }
  .party div { font-size: 11px; color: #374151; }
  table.lines { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 22px; }
  table.lines thead th { background: ${accent}; color: #fff; text-align: left; padding: 7px 5px; font-size: 8px; text-transform: uppercase; letter-spacing: .2px; }
  table.lines thead th.num, table.lines td.num { text-align: right; }
  table.lines tbody td { padding: 7px 5px; border-bottom: 1px solid #e5e7eb; vertical-align: top; font-size: 9px; overflow-wrap: anywhere; }
  table.lines tbody tr:nth-child(even) { background: #f9fafb; }
  td.concept { font-weight: 600; }
  td.description { color: #4b5563; }
  .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals table { border-collapse: collapse; min-width: 280px; }
  .totals td { padding: 5px 10px; font-size: 12px; }
  .totals td.num { text-align: right; }
  .totals tr.grand td { border-top: 2px solid ${accent}; font-weight: 800; font-size: 15px; color: ${accent}; padding-top: 8px; }
  .pay { margin-top: 22px; padding: 12px 14px; background: #f3f4f6; border-radius: 8px; }
  .pay h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: #6b7280; }
  .muted { color: #6b7280; font-size: 11px; }
  .notes { margin-top: 16px; white-space: pre-wrap; font-size: 11px; color: #374151; }
  .terms { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; white-space: pre-wrap; }
  .watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 90px; font-weight: 800; color: rgba(0,0,0,0.05); transform: rotate(-22deg); pointer-events: none; z-index: 0; }
  .print-btn { position: fixed; top: 12px; right: 12px; background: ${accent}; color: #fff; border: 0; padding: 10px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
  ${watermark ? `<div class="watermark">${esc(watermark)}</div>` : ""}
  <button class="print-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
  <div class="sheet">
    <div class="top">
      <div>
        ${
          inv.issuer.logoUrl
            ? `<img class="logo" src="${esc(inv.issuer.logoUrl)}" alt="" />`
            : `<div class="brandname">${esc(inv.issuer.name ?? "")}</div>`
        }
        <div class="muted" style="margin-top:6px">${partyLines(inv.issuer)}</div>
      </div>
      <div class="doc-meta">
        <div class="doc-title">${esc(typeLabel)}</div>
        <div class="doc-number">${esc(inv.number ?? "(borrador)")}</div>
        <div class="doc-dates">
          Fecha: ${fmtDate(inv.issueDate)}<br />
          ${inv.dueDate ? `Vencimiento: ${fmtDate(inv.dueDate)}` : ""}
        </div>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <h3>${inv.type === "PRESUPUESTO" ? "Para" : "Facturar a"}</h3>
        <div class="pname">${esc(inv.client.name ?? "")}</div>
        ${partyLines(inv.client)}
      </div>
    </div>

    <table class="lines">
      <colgroup><col style="width:17%"><col style="width:25%"><col style="width:12%"><col style="width:9%"><col style="width:12%"><col style="width:13%"><col style="width:12%"></colgroup>
      <thead>
        <tr>
          <th>Concepto</th>
          <th>Descripción</th>
          <th class="num">Precio</th>
          <th class="num">Unidades</th>
          <th class="num">Subtotal</th>
          <th class="num">Impuestos</th>
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td>Base imponible</td><td class="num">${formatMoney(totals.subtotalCents, cur)}</td></tr>
        ${taxRows}
        <tr class="grand"><td>Total</td><td class="num">${formatMoney(totals.totalCents, cur)}</td></tr>
      </table>
    </div>

    <div class="pay">
      <h4>Forma de pago</h4>
      <div>${esc(PAYMENT_METHOD_LABEL[inv.paymentMethod as PaymentMethod] ?? inv.paymentMethod)}</div>
      ${payExtra}
    </div>

    ${inv.notes ? `<div class="notes">${esc(inv.notes)}</div>` : ""}
    ${inv.terms ? `<div class="terms">${esc(inv.terms)}</div>` : ""}
  </div>
  ${opts?.autoprint ? "<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});</script>" : ""}
</body>
</html>`;
}
