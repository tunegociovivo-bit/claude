import { describe, expect, it } from "vitest";
import { buildInvoiceHtml, buildInvoiceEmailHtml } from "../invoice-html";
import { buildInvoicePdf } from "../invoice-pdf";

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
  it("shows only one compact value in the tax column", () => {
    const html = buildInvoiceHtml(invoice);
    expect(html).toContain(">Tax 0%</td>");
    expect(html).not.toContain("Tax 0%<br>");
  });

  it("builds an email-safe layout without flexbox or fixed controls", () => {
    const html = buildInvoiceEmailHtml(invoice);
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/display:\s*flex|position:\s*fixed|onclick=/i);
  });

  it("creates a real PDF document", async () => {
    const pdf = await buildInvoicePdf(invoice);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });
});
