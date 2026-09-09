import { describe, expect, it } from "vitest";
import { matchIncomingPayment, matchSepaReceipt, matchUniqueSepaSummary, shouldImportMovement, shouldReprocessExistingBankTransaction } from "../matching";

const cutoff = new Date("2026-08-09T22:00:00.000Z"); // 10/08/2026 00:00 Europe/Madrid

const invoices = [
  { id: "new", number: "FAC-003024", clientName: "RS advocats", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-08-09T00:00:00Z") },
  { id: "old", number: "FAC-002861", clientName: "RS advocats", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-05-09T00:00:00Z") },
  { id: "other", number: "FAC-003099", clientName: "Otro cliente", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-08-10T00:00:00Z") }
];

describe("conciliación bancaria desde la fecha de corte", () => {
  it("ignora movimientos anteriores, pero importa cargos como gastos", () => {
    expect(shouldImportMovement({ bookedAt: new Date("2026-08-09T21:59:59Z"), amountCents: 36300 }, cutoff)).toBe(false);
    expect(shouldImportMovement({ bookedAt: cutoff, amountCents: -36300 }, cutoff)).toBe(true);
    expect(shouldImportMovement({ bookedAt: cutoff, amountCents: 36300 }, cutoff)).toBe(true);
  });

  it("prioriza el número exacto de factura", () => {
    expect(matchIncomingPayment({ amountCents: 36300, reference: "Cobro FAC-003024", counterpartyName: "" }, invoices)).toMatchObject({ invoiceId: "new", confidence: "EXACT_REFERENCE" });
  });

  it("deja en revisión cliente e importe cuando hay más de una factura posible", () => {
    expect(matchIncomingPayment({ amountCents: 36300, reference: "Adeudo SEPA", counterpartyName: "RS ADVOCATS" }, invoices)).toBeNull();
  });

  it("concilia por cliente e importe solo si la factura es única", () => {
    expect(matchIncomingPayment({ amountCents: 36300, reference: "Adeudo SEPA", counterpartyName: "RS ADVOCATS" }, [invoices[0], invoices[2]])).toMatchObject({ invoiceId: "new", confidence: "CLIENT_AMOUNT" });
  });

  it("no concilia automáticamente cuando solo coincide el importe", () => {
    expect(matchIncomingPayment({ amountCents: 36300, reference: "Ingreso", counterpartyName: "Desconocido" }, invoices)).toBeNull();
  });
  it("matches a unique SEPA summary by date and amount", () => {
    expect(matchUniqueSepaSummary(
      { amountCents: 42350, bookedAt: new Date("2026-08-12T12:00:00Z") },
      [{ invoiceId: "invoice-423", amountCents: 42350, chargeDate: new Date("2026-08-10T08:00:00Z") }]
    )).toMatchObject({ invoiceId: "invoice-423", confidence: "SEPA_RECEIPT" });
  });

  it("leaves an ambiguous SEPA summary unmatched", () => {
    expect(matchUniqueSepaSummary(
      { amountCents: 18150, bookedAt: new Date("2026-08-12T12:00:00Z") },
      [
        { invoiceId: "invoice-a", amountCents: 18150, chargeDate: new Date("2026-08-12T07:00:00Z") },
        { invoiceId: "invoice-b", amountCents: 18150, chargeDate: new Date("2026-08-12T09:00:00Z") }
      ]
    )).toBeNull();
  });

  it("rejects requests outside the safe settlement window", () => {
    expect(matchUniqueSepaSummary(
      { amountCents: 54450, bookedAt: new Date("2026-08-13T12:00:00Z") },
      [{ invoiceId: "too-old", amountCents: 54450, chargeDate: new Date("2026-08-08T08:00:00Z") }]
    )).toBeNull();
  });

  it("rejects an archived SEPA request even when amount and date are unique", () => {
    expect(matchUniqueSepaSummary(
      { amountCents: 336267, bookedAt: new Date("2026-09-02T12:00:00Z") },
      [{
        invoiceId: "invoice-archived",
        amountCents: 336267,
        chargeDate: new Date("2026-08-31T08:00:00Z"),
        archivedAt: new Date("2026-09-01T08:00:00Z")
      }]
    )).toBeNull();
  });

  it("deduplicates the same invoice represented by a job and its SEPA request", () => {
    expect(matchSepaReceipt(
      { amountCents: 169400, debtorIbanLast4: "0770", bookedAt: new Date("2026-09-09T08:00:00Z") },
      [
        { invoiceId: "fac-003068", amountCents: 169400, ibanMasked: "****0770", chargeDate: new Date("2026-09-09T07:00:00Z") },
        { invoiceId: "fac-003068", amountCents: 169400, ibanMasked: "ES**0770", chargeDate: new Date("2026-09-09T07:00:00Z") }
      ]
    )).toMatchObject({ invoiceId: "fac-003068", confidence: "SEPA_RECEIPT" });
  });

  it("reprocesses only unmatched receipts that now have verified identifiers", () => {
    expect(shouldReprocessExistingBankTransaction("UNMATCHED", true)).toBe(true);
    expect(shouldReprocessExistingBankTransaction("UNMATCHED", false)).toBe(false);
    expect(shouldReprocessExistingBankTransaction("MATCHED", true)).toBe(false);
  });
});
