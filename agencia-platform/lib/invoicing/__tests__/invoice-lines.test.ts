import { describe, expect, it } from "vitest";
import { computeInvoiceLineAmounts } from "../core";
import { invoiceCreateSchema } from "../../api/schemas";

describe("invoice line columns", () => {
  it("calculates subtotal, taxes and total for each line", () => {
    expect(computeInvoiceLineAmounts({
      concept: "Consultoría",
      description: "Servicio mensual",
      quantity: 2,
      unitPriceCents: 10_000,
      taxRate: 21
    })).toEqual({ subtotalCents: 20_000, taxCents: 4_200, totalCents: 24_200, discountCents: 0 });
  });

  it("keeps concept optional for old invoices", () => {
    expect(computeInvoiceLineAmounts({ description: "Línea antigua", quantity: 1, unitPriceCents: 5_000, taxRate: 0 }).totalCents).toBe(5_000);
  });

  it("allows an empty description when the concept identifies the line", () => {
    const parsed = invoiceCreateSchema.safeParse({
      clientId: "client-1",
      issuerId: "issuer-1",
      lines: [{ concept: "Consultoría", description: "", quantity: 1, unitPriceCents: 5000, taxRate: 0 }]
    });
    expect(parsed.success).toBe(true);
  });
});
