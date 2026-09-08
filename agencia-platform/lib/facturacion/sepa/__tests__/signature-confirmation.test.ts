import { describe, expect, it } from "vitest";
import { selectSignatureConfirmations } from "../signature-confirmation";

const requests = [
  { id: "manual", invoiceNumber: "FAC-003057", status: "PENDING_APPROVAL", archivedAt: null, jobStatuses: [] },
  { id: "prepared", invoiceNumber: "FAC-003066", status: "PENDING_SIGNATURE", archivedAt: null, jobStatuses: ["PREPARED_PENDING_SIGNATURE"] },
  { id: "running", invoiceNumber: "FAC-003099", status: "APPROVED", archivedAt: null, jobStatuses: ["RUNNING"] },
  { id: "signed", invoiceNumber: "FAC-003040", status: "SIGNED", archivedAt: null, jobStatuses: [] },
  { id: "archived", invoiceNumber: "FAC-003001", status: "PENDING_SIGNATURE", archivedAt: new Date(), jobStatuses: [] }
];

describe("confirmación administrativa de firma SEPA", () => {
  it("permite confirmar facturas manuales concretas aunque no pasaran por el agente", () => {
    expect(selectSignatureConfirmations(requests, { requestIds: ["manual"] }).map((row) => row.id)).toEqual(["manual"]);
  });

  it("en modo masivo solo confirma las que realmente estaban pendientes de firma", () => {
    expect(selectSignatureConfirmations(requests, { allPendingSignature: true }).map((row) => row.id)).toEqual(["prepared"]);
  });

  it("no reabre firmadas ni solicitudes archivadas", () => {
    expect(selectSignatureConfirmations(requests, { requestIds: ["signed", "archived"] })).toEqual([]);
  });

  it("rechaza estados que el agente puede estar ejecutando", () => {
    expect(selectSignatureConfirmations(requests, { requestIds: ["running"] })).toEqual([]);
  });

  it("distingue solicitudes con el mismo número de factura", () => {
    const duplicate = { id: "other-company", invoiceNumber: "FAC-003057", status: "PENDING_APPROVAL", archivedAt: null, jobStatuses: [] };
    expect(selectSignatureConfirmations([...requests, duplicate], { requestIds: ["manual"] }).map((row) => row.id)).toEqual(["manual"]);
  });
});
