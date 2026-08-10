import { describe, expect, it } from "vitest";
import { matchIncomingPayment, shouldImportMovement } from "../matching";

const cutoff = new Date("2026-08-09T22:00:00.000Z"); // 10/08/2026 00:00 Europe/Madrid

const invoices = [
  { id: "new", number: "FAC-003024", clientName: "RS advocats", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-08-09T00:00:00Z") },
  { id: "old", number: "FAC-002861", clientName: "RS advocats", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-05-09T00:00:00Z") },
  { id: "other", number: "FAC-003099", clientName: "Otro cliente", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-08-10T00:00:00Z") }
];

describe("conciliación bancaria desde la fecha de corte", () => {
  it("ignora movimientos anteriores al inicio y cargos negativos", () => {
    expect(shouldImportMovement({ bookedAt: new Date("2026-08-09T21:59:59Z"), amountCents: 36300 }, cutoff)).toBe(false);
    expect(shouldImportMovement({ bookedAt: cutoff, amountCents: -36300 }, cutoff)).toBe(false);
    expect(shouldImportMovement({ bookedAt: cutoff, amountCents: 36300 }, cutoff)).toBe(true);
  });

  it("prioriza el número exacto de factura", () => {
    expect(matchIncomingPayment({ amountCents: 36300, reference: "Cobro FAC-003024", counterpartyName: "" }, invoices)).toMatchObject({ invoiceId: "new", confidence: "EXACT_REFERENCE" });
  });

  it("elige la factura pendiente más reciente cuando cliente e importe coinciden", () => {
    expect(matchIncomingPayment({ amountCents: 36300, reference: "Adeudo SEPA", counterpartyName: "RS ADVOCATS" }, invoices)).toMatchObject({ invoiceId: "new", confidence: "CLIENT_AMOUNT" });
  });

  it("no concilia automáticamente cuando solo coincide el importe", () => {
    expect(matchIncomingPayment({ amountCents: 36300, reference: "Ingreso", counterpartyName: "Desconocido" }, invoices)).toBeNull();
  });
});
