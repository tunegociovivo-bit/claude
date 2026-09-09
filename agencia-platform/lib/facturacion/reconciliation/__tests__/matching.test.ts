import { describe, expect, it } from "vitest";
import { effectiveSepaCandidateDate, matchIncomingPayment, matchSepaReceipt, matchUniqueSepaSummary, persistedBankReference, requiresVerifiedSepaReceipt, shouldImportMovement, shouldReprocessExistingBankTransaction } from "../matching";

const cutoff = new Date("2026-08-09T22:00:00.000Z"); // 10/08/2026 00:00 Europe/Madrid

it("requires verified debtor data for every SEPA remittance credit", () => {
  expect(requiresVerifiedSepaReceipt("Emision Remesa Sepa Sdd Referencia: 004966117530000675")).toBe(true);
  expect(requiresVerifiedSepaReceipt("Ingreso ordinario", "004966117530000675")).toBe(true);
  expect(requiresVerifiedSepaReceipt("Transferencia FAC-003068", null)).toBe(false);
});

it("persists the SEPA nature so later retries cannot match it generically", () => {
  const stored = persistedBankReference("Ingreso ordinario", "004966117530000675");
  expect(stored).toContain("Remesa SEPA 004966117530000675");
  expect(requiresVerifiedSepaReceipt(stored)).toBe(true);
});

const invoices = [
  { id: "new", number: "FAC-003024", clientName: "RS advocats", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-08-09T00:00:00Z") },
  { id: "old", number: "FAC-002861", clientName: "RS advocats", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-05-09T00:00:00Z") },
  { id: "other", number: "FAC-003099", clientName: "Otro cliente", totalCents: 36300, paidCents: 0, issueDate: new Date("2026-08-10T00:00:00Z") }
];

it("uses request creation date for a manually prepared remittance without chargeDate", () => {
  const createdAt = new Date("2026-09-08T13:34:00Z");
  expect(effectiveSepaCandidateDate(null, createdAt)).toEqual(createdAt);
  expect(effectiveSepaCandidateDate(new Date("2026-09-09T08:00:00Z"), createdAt)).toEqual(new Date("2026-09-09T08:00:00Z"));
});

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
  it("does not match a SEPA summary using only date and amount", () => {
    expect(matchUniqueSepaSummary(
      { amountCents: 42350, bookedAt: new Date("2026-08-12T12:00:00Z") },
      [{ invoiceId: "invoice-423", amountCents: 42350, chargeDate: new Date("2026-08-10T08:00:00Z") }]
    )).toBeNull();
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

  it("ignores historical remittances whose invoice is no longer outstanding", () => {
    expect(matchUniqueSepaSummary(
      { amountCents: 169400, bookedAt: new Date("2026-09-09T12:00:00Z") },
      [
        { invoiceId: "fac-003017", amountCents: 169400, chargeDate: new Date("2026-09-07T08:00:00Z"), outstanding: false },
        { invoiceId: "fac-003068", amountCents: 169400, chargeDate: new Date("2026-09-08T08:00:00Z"), outstanding: true }
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

  it("matches a verified debtor when Santander settles the remittance on a later day", () => {
    expect(matchSepaReceipt(
      { amountCents: 24200, debtorIbanLast4: "1845", bookedAt: new Date("2026-09-09T08:00:00Z") },
      [{ invoiceId: "fac-003063", amountCents: 24200, ibanMasked: "****1845", chargeDate: new Date("2026-09-07T08:00:00Z") }]
    )).toMatchObject({ invoiceId: "fac-003063", confidence: "SEPA_RECEIPT" });
  });

  it("never assigns a payment to a remittance created after that payment", () => {
    expect(matchSepaReceipt(
      { amountCents: 24200, debtorIbanLast4: "1845", bookedAt: new Date("2026-09-09T08:00:00Z") },
      [{ invoiceId: "future", amountCents: 24200, ibanMasked: "****1845", chargeDate: new Date("2026-09-09T08:00:01Z") }]
    )).toBeNull();
  });

  it("reprocesses only unmatched receipts that now have verified identifiers", () => {
    expect(shouldReprocessExistingBankTransaction("UNMATCHED", true)).toBe(true);
    expect(shouldReprocessExistingBankTransaction("UNMATCHED", false)).toBe(false);
    expect(shouldReprocessExistingBankTransaction("MATCHED", true)).toBe(false);
  });
});
