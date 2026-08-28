import { describe, expect, it } from "vitest";
import { buildInvoiceHtml, buildInvoiceEmailHtml } from "../invoice-html";
import { buildInvoicePdf, invoiceTableDescription } from "../invoice-pdf";

const invoice = {
  type: "NORMAL",
  status: "SENT",
  number: "FAC-2026-0204",
  issueDate: new Date("2026-08-28T00:00:00Z"),
  dueDate: new Date("2026-09-27T00:00:00Z"),
  currency: "USD",
  paymentMethod: "STRIPE",
  lines: [{ concept: "Marketing", description: "", quantity: 1, unitPriceCents: 64972, taxRate: 0 }],
  issuer: { name: "RIXUS SOLUTIONS LLC", taxId: "37-2141153" },
  client: { name: "Cliente" }
};

describe("invoice rendering", () => {
  it("renders Rixus USD invoices entirely in English", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain('lang="en"');
    expect(html).toContain(">Invoice</div>");
    expect(html).toContain("Issue date:");
    expect(html).toContain("Due date:");
    expect(html).toContain(">Bill to</h3>");
    expect(html).toContain(">Description</th>");
    expect(html).toContain(">Unit price</th>");
    expect(html).toContain(">Quantity</th>");
    expect(html).toContain(">Taxes</th>");
    expect(html).toContain(">Payment method</h4>");
    expect(html).toContain("$649.72");
    expect(html).not.toContain("Factura");
    expect(html).not.toContain("Facturar a");
    expect(html).not.toContain("Forma de pago");
  });

  it("keeps Rixus EUR invoices in Spanish", () => {
    const html = buildInvoiceHtml({ ...invoice, currency: "EUR" });
    expect(html).toContain('lang="es"');
    expect(html).toContain("Factura");
    expect(html).toContain("Facturar a");
    expect(html).toContain("Forma de pago");
  });

  it("shows only one compact value in the tax column", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain(">Tax 0%</td>");
    expect(html).not.toContain("Tax 0%<br>");
  });

  it("builds an email-safe layout without flexbox or fixed controls", () => {
    const html = buildInvoiceEmailHtml({ ...invoice, paymentMethod: "TRANSFER", notes: "Nota visible", terms: "Condiciones visibles", issuer: { ...invoice.issuer, iban: "US00 TEST" } });
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/display:\s*flex|position:\s*fixed|onclick=/i);
    expect(html).toContain("Nota visible");
    expect(html).toContain("Condiciones visibles");
    expect(html).toContain("US00 TEST");
  });

  it("paginates long invoices without truncating their descriptions", async () => {
    const long = "Servicio de consultoría y seguimiento con una descripción fiscal extensa ".repeat(4);
    const pdf = await buildInvoicePdf({ ...invoice, lines: Array.from({ length: 30 }, (_, index) => ({ ...invoice.lines[0], concept: `Servicio ${index + 1}`, description: long })) });
    const source = pdf.toString("latin1");
    expect((source.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it("moves a single oversized description to a full paginated appendix", () => {
    const description = "Detalle contractual ".repeat(120);
    const rendered = invoiceTableDescription(description);
    expect(rendered.table).toContain("ver detalle completo");
    expect(rendered.appendix).toBe(description);
  });

  it("renders a maximum description safely when concept is empty", async () => {
    const description = "X".repeat(2_000);
    const pdf = await buildInvoicePdf({ ...invoice, lines: [{ ...invoice.lines[0], concept: "", description }] });
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.length).toBeLessThanOrEqual(3);
  });

  it("creates a real PDF document", async () => {
    const pdf = await buildInvoicePdf(invoice);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });
});
