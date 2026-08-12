import { describe, expect, it } from "vitest";
import { invoiceSequence, isApprovedNormalHoldedInvoice } from "../holded-auto-sync";

describe("isApprovedNormalHoldedInvoice", () => {
  it("acepta una factura aprobada con número fiscal", () => {
    expect(isApprovedNormalHoldedInvoice({ number: "FAC-003020", status: "ISSUED" })).toBe(true);
  });

  it.each([
    [{ number: "FAC-003020", status: "DRAFT" }, "borrador"],
    [{ number: "R-003020", status: "ISSUED" }, "rectificativa"],
    [{ number: " r-003020", status: "ISSUED" }, "rectificativa con espacios"],
    [{ status: "ISSUED" }, "sin número"]
  ])("rechaza %s (%s)", (input, _description) => {
    expect(isApprovedNormalHoldedInvoice(input)).toBe(false);
  });
});

describe("invoiceSequence", () => {
  it("extrae la secuencia fiscal FAC", () => {
    expect(invoiceSequence("FAC-003027")).toBe(3027);
  });

  it("rechaza otras series", () => {
    expect(invoiceSequence("R-003027")).toBeNull();
  });
});
