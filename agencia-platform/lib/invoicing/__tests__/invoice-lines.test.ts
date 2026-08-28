import { describe, expect, it } from "vitest";
import { computeInvoiceLineAmounts } from "../core";

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
});
