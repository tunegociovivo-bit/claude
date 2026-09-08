import { describe, expect, it } from "vitest";
import { selectSignatureConfirmations, shouldCancelJobAfterSignature } from "../signature-confirmation";

const requests = [
  { id: "manual", invoiceNumber: "FAC-003057", status: "PENDING_APPROVAL", archivedAt: null },
  { id: "prepared", invoiceNumber: "FAC-003066", status: "PENDING_SIGNATURE", archivedAt: null },
  { id: "signed", invoiceNumber: "FAC-003040", status: "SIGNED", archivedAt: null },
  { id: "archived", invoiceNumber: "FAC-003001", status: "PENDING_SIGNATURE", archivedAt: new Date() }
];

describe("confirmación administrativa de firma SEPA", () => {
  it("permite confirmar facturas manuales concretas aunque no pasaran por el agente", () => {
    expect(selectSignatureConfirmations(requests, { invoiceNumbers: ["fac-003057"] }).map((row) => row.id)).toEqual(["manual"]);
  });

  it("en modo masivo solo confirma las que realmente estaban pendientes de firma", () => {
    expect(selectSignatureConfirmations(requests, { allPendingSignature: true }).map((row) => row.id)).toEqual(["prepared"]);
  });

  it("no reabre firmadas ni solicitudes archivadas", () => {
    expect(selectSignatureConfirmations(requests, { invoiceNumbers: ["FAC-003040", "FAC-003001"] })).toEqual([]);
  });

  it("cancela trabajos todavía ejecutables para evitar una segunda remesa", () => {
    expect(shouldCancelJobAfterSignature("PENDING")).toBe(true);
    expect(shouldCancelJobAfterSignature("RUNNING")).toBe(true);
    expect(shouldCancelJobAfterSignature("PREPARED_PENDING_SIGNATURE")).toBe(false);
    expect(shouldCancelJobAfterSignature("CANCELLED")).toBe(false);
  });
});
