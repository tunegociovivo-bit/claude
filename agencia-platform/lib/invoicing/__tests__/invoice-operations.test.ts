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

  it("no afirma que el correo fue enviado si la notificación sigue pendiente", () => {
    const result = getInvoiceOperations({
      ...base,
      remittance: { status: "PENDING_APPROVAL", approvalNotifiedAt: null, jobStatus: null }
    });
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "approval", label: "Correo de aprobación pendiente", tone: "danger" })
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
      reconciliation: { status: "MATCHED", matchedAt: "2026-09-08T10:00:00.000Z", matchConfidence: "EXACT_REFERENCE" }
    });

    expect(result.overall).toBe("COMPLETE");
    expect(result.summary).toBe("Completada y conciliada");
    expect(result.stages.every((stage) => stage.tone === "success")).toBe(true);
  });

  it("no vuelve a pedir firma por conservar el trabajo histórico preparado", () => {
    const result = getInvoiceOperations({
      ...base,
      remittance: { status: "SIGNED", approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus: "PREPARED_PENDING_SIGNATURE" }
    });
    expect(result.overall).toBe("IN_PROGRESS");
    expect(result.summary).toBe("Pendiente de cobro");
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "signature", label: "Remesa firmada", tone: "success" })
    ]));
  });

  it("considera cerrada una remesa conciliada aunque Santander no haya avanzado el estado interno de firma", () => {
    const result = getInvoiceOperations({
      ...base,
      status: "PAID",
      paidCents: 36_300,
      remittance: { status: "PENDING_SIGNATURE", approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus: "PREPARED_PENDING_SIGNATURE" },
      reconciliation: { status: "MATCHED", matchedAt: "2026-09-08T10:00:00.000Z", matchConfidence: "SEPA_REQUEST_DATE_AMOUNT" }
    });
    expect(result.overall).toBe("COMPLETE");
    expect(result.stages.every((stage) => stage.tone === "success")).toBe(true);
  });

  it("mantiene firma y conciliación separadas cuando el pago fue una transferencia", () => {
    const result = getInvoiceOperations({
      ...base,
      status: "PAID",
      paidCents: 36_300,
      remittance: { status: "PENDING_SIGNATURE", approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus: "PREPARED_PENDING_SIGNATURE" },
      reconciliation: { status: "MATCHED", matchedAt: "2026-09-08T10:00:00.000Z", matchConfidence: "EXACT_REFERENCE" }
    });
    expect(result.summary).toBe("Firma requerida");
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "signature", label: "Pendiente de firma", tone: "danger" }),
      expect.objectContaining({ key: "reconciliation", label: "Conciliada", tone: "success" })
    ]));
  });

  it("no exige remesa a rectificativas ni facturas con otro método de pago", () => {
    expect(getInvoiceOperations({ ...base, type: "RECTIFICATIVA", number: "R-003101" }).overall).toBe("NOT_APPLICABLE");
    expect(getInvoiceOperations({ ...base, paymentMethod: "TRANSFER" }).overall).toBe("IN_PROGRESS");
    expect(getInvoiceOperations({ ...base, remittanceExcluded: true }).summary).toBe("Excluida de remesas");
  });

  it("tracks payment reconciliation for invoices paid by bank transfer", () => {
    const pending = getInvoiceOperations({ ...base, paymentMethod: "TRANSFER" });
    expect(pending.summary).toBe("Pendiente de cobro");
    expect(pending.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "reconciliation", label: "Pendiente de conciliar", tone: "warning" })
    ]));

    const paid = getInvoiceOperations({
      ...base,
      paymentMethod: "TRANSFER",
      status: "PAID",
      paidCents: 36_300,
      paidAt: "2026-09-09T08:00:00.000Z",
      reconciliation: { status: "MATCHED", matchedAt: "2026-09-09T08:00:00.000Z", matchConfidence: "EXACT_REFERENCE" }
    });
    expect(paid.overall).toBe("COMPLETE");
    expect(paid.summary).toBe("Cobrada y conciliada");
  });

  it("no oculta un trabajo activo aunque la factura se excluya después", () => {
    const result = getInvoiceOperations({
      ...base,
      remittanceExcluded: true,
      remittance: { status: "PENDING_SIGNATURE", approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus: "PREPARED_PENDING_SIGNATURE" }
    });
    expect(result.summary).toBe("Firma requerida");
  });

  it.each([
    ["REJECTED", null, "Remesa rechazada"],
    ["EXPIRED", null, "Aprobación caducada"],
    ["APPROVED", "CANCELLED", "Trabajo cancelado"]
  ])("trata %s/%s como acción requerida", (status, jobStatus, summary) => {
    const result = getInvoiceOperations({
      ...base,
      remittance: { status, approvalNotifiedAt: "2026-09-08T08:00:00.000Z", jobStatus }
    });
    expect(result.overall).toBe("ACTION_REQUIRED");
    expect(result.summary).toBe(summary);
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
