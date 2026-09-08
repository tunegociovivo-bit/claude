export type OperationTone = "success" | "info" | "warning" | "danger" | "neutral";

export type InvoiceOperationStage = {
  key: "approval" | "approved" | "signature" | "reconciliation";
  label: string;
  tone: OperationTone;
};

export type InvoiceOperationsInput = {
  type: string;
  status: string;
  number: string | null;
  paymentMethod: string;
  totalCents: number;
  paidCents: number;
  paidAt: string | Date | null;
  remittanceExcluded?: boolean;
  remittance: {
    status: string;
    approvalNotifiedAt: string | Date | null;
    jobStatus: string | null;
  } | null;
  reconciliation: { status: string; matchedAt: string | Date | null; matchConfidence: string | null } | null;
};

export type InvoiceOperations = {
  overall: "COMPLETE" | "ACTION_REQUIRED" | "IN_PROGRESS" | "NOT_APPLICABLE";
  summary: string;
  stages: InvoiceOperationStage[];
};

const APPROVED = new Set(["APPROVED", "PREPARING", "PENDING_SIGNATURE", "SIGNED"]);

export function getInvoiceOperations(invoice: InvoiceOperationsInput): InvoiceOperations {
  const notApplicable = !invoice.remittance && (invoice.remittanceExcluded
    || invoice.type === "RECTIFICATIVA"
    || /^R-/i.test(invoice.number ?? "")
    || invoice.paymentMethod !== "REMITTANCE"
    || invoice.status === "DRAFT"
    || invoice.status === "CANCELLED");

  if (notApplicable) {
    return {
      overall: "NOT_APPLICABLE",
      summary: invoice.remittanceExcluded ? "Excluida de remesas" : "No requiere remesa",
      stages: [
        { key: "approval", label: "Remesa no aplicable", tone: "neutral" },
        { key: "approved", label: "Aprobación no aplicable", tone: "neutral" },
        { key: "signature", label: "Firma no aplicable", tone: "neutral" },
        { key: "reconciliation", label: invoice.status === "PAID" ? "Cobrada" : "Sin conciliación SEPA", tone: "neutral" }
      ]
    };
  }

  const requestStatus = invoice.remittance?.status ?? null;
  const jobStatus = invoice.remittance?.jobStatus ?? null;
  const reconciled = invoice.reconciliation?.status === "MATCHED";
  const reconciledBySepa = reconciled && invoice.reconciliation?.matchConfidence?.startsWith("SEPA_");
  const signed = requestStatus === "SIGNED" || reconciledBySepa;
  const approved = requestStatus ? APPROVED.has(requestStatus) : false;
  const failed = !signed && (requestStatus === "FAILED" || jobStatus === "FAILED" || jobStatus === "NEEDS_USER");
  const pendingSignature = !signed && (requestStatus === "PENDING_SIGNATURE" || jobStatus === "PREPARED_PENDING_SIGNATURE");
  const terminalSummary = requestStatus === "REJECTED"
    ? "Remesa rechazada"
    : requestStatus === "EXPIRED"
      ? "Aprobación caducada"
      : !signed && jobStatus === "CANCELLED" ? "Trabajo cancelado" : null;

  const approvalStage: InvoiceOperationStage = approved || signed
    ? { key: "approval", label: "Aprobación completada", tone: "success" }
    : invoice.remittance?.approvalNotifiedAt
      ? { key: "approval", label: "Aprobación enviada", tone: requestStatus === "PENDING_APPROVAL" ? "warning" : "success" }
      : invoice.remittance
        ? { key: "approval", label: "Correo de aprobación pendiente", tone: "danger" }
        : { key: "approval", label: "Sin solicitud", tone: "danger" };

  const stages: InvoiceOperationStage[] = [
    approvalStage,
    approved || signed
      ? { key: "approved", label: "Remesa aprobada", tone: "success" }
      : { key: "approved", label: requestStatus === "REJECTED" ? "Remesa rechazada" : requestStatus === "EXPIRED" ? "Aprobación caducada" : "Pendiente de aprobar", tone: requestStatus === "PENDING_APPROVAL" ? "warning" : "danger" },
    signed
      ? { key: "signature", label: "Remesa firmada", tone: "success" }
      : pendingSignature
        ? { key: "signature", label: "Pendiente de firma", tone: "danger" }
        : failed
          ? { key: "signature", label: "Error al preparar", tone: "danger" }
          : { key: "signature", label: approved ? "Preparando remesa" : "Firma pendiente", tone: approved ? "info" : "neutral" },
    reconciled
      ? { key: "reconciliation", label: "Conciliada", tone: "success" }
      : { key: "reconciliation", label: "Pendiente de conciliar", tone: signed ? "warning" : "neutral" }
  ];

  if (signed && reconciled) return { overall: "COMPLETE", summary: "Completada y conciliada", stages };
  if (failed) return { overall: "ACTION_REQUIRED", summary: "Error de remesa", stages };
  if (terminalSummary) return { overall: "ACTION_REQUIRED", summary: terminalSummary, stages };
  if (pendingSignature) return { overall: "ACTION_REQUIRED", summary: "Firma requerida", stages };
  if (requestStatus === "PENDING_APPROVAL") return {
    overall: "ACTION_REQUIRED",
    summary: invoice.remittance?.approvalNotifiedAt ? "Aprobar remesa" : "Correo de aprobación pendiente",
    stages
  };
  if (!invoice.remittance) return { overall: "ACTION_REQUIRED", summary: "Sin solicitud de remesa", stages };
  if (signed && !reconciled) return { overall: "IN_PROGRESS", summary: "Pendiente de cobro", stages };
  return { overall: "IN_PROGRESS", summary: "Remesa en proceso", stages };
}
