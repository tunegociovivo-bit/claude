import { describe, expect, it } from "vitest";
import { getInvoiceOperations } from "@/lib/invoicing/invoice-operations";

describe("getInvoiceOperations", () => {
  const base = {
    type: "NORMAL",
    status: "ISSUED",
    number: "FAC-003100",
    paymentMethod: "REMITTANCE",
    paidCents: 0,
    totalCents: 36_300,
    paidAt: null,
    remittance: null,
    reconciliation: null
  } as const;

  it("destaca la aprobación como acción manual pendiente", () => {
    const result = getInvoiceOperations({
      ...base,
      remittance: { status: "PENDING_APPROVAL", approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus: null }
    });

    expect(result.overall).toBe("ACTION_REQUIRED");
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "approval", label: "Aprobación enviada", tone: "warning" })
    ]));
  });

  it("señala con máxima prioridad una remesa preparada que requiere firma", () => {
    const result = getInvoiceOperations({
      ...base,
      remittance: { status: "PENDING_SIGNATURE", approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus: "PREPARED_PENDING_SIGNATURE" }
    });

    expect(result.overall).toBe("ACTION_REQUIRED");
    expect(result.summary).toBe("Firma requerida");
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "signature", label: "Pendiente de firma", tone: "danger" })
    ]));
  });

  it("marca todo en verde cuando está firmada y conciliada", () => {
    const result = getInvoiceOperations({
      ...base,
      status: "PAID",
      paidCents: 36_300,
      paidAt: "2026-09-08T10:00:00.000Z",
      remittance: { status: "SIGNED", approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus: "PREPARED_PENDING_SIGNATURE" },
      reconciliation: { status: "MATCHED", matchedAt: "2026-09-08T10:00:00.000Z" }
    });

    expect(result.overall).toBe("COMPLETE");
    expect(result.summary).toBe("Completada y conciliada");
    expect(result.stages.every((stage) => stage.tone === "success")).toBe(true);
  });

  it("no exige remesa a rectificativas ni facturas con otro método de pago", () => {
    expect(getInvoiceOperations({ ...base, type: "RECTIFICATIVA", number: "R-003101" }).overall).toBe("NOT_APPLICABLE");
    expect(getInvoiceOperations({ ...base, paymentMethod: "TRANSFER" }).overall).toBe("NOT_APPLICABLE");
  });

  it("muestra los fallos del agente como intervención prioritaria", () => {
    const result = getInvoiceOperations({
      ...base,
      remittance: { status: "FAILED", approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus: "FAILED" }
    });

    expect(result.overall).toBe("ACTION_REQUIRED");
    expect(result.summary).toBe("Error de remesa");
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "signature", tone: "danger" })
    ]));
  });
});
