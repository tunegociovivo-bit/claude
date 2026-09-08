import { prisma } from "@/lib/db/prisma";

type SignatureRequest = {
  id: string;
  invoiceNumber: string | null;
  status: string;
  archivedAt: Date | null;
  jobStatuses?: string[];
};

export type SignatureConfirmationSelection = {
  requestIds?: string[];
  allPendingSignature?: boolean;
};

export function selectSignatureConfirmations<T extends SignatureRequest>(
  requests: T[],
  selection: SignatureConfirmationSelection
): T[] {
  const requestIds = new Set((selection.requestIds ?? []).map((id) => id.trim()).filter(Boolean));
  return requests.filter((request) => {
    if (request.archivedAt || request.status === "SIGNED") return false;
    const safeState = request.status === "PENDING_SIGNATURE"
      || (request.status === "PENDING_APPROVAL" && (request.jobStatuses?.length ?? 0) === 0);
    if (!safeState) return false;
    const selectedById = requestIds.has(request.id);
    const selectedByPendingStatus = selection.allPendingSignature === true && request.status === "PENDING_SIGNATURE";
    return selectedById || selectedByPendingStatus;
  });
}

export async function confirmRemittancesSigned(
  workspaceId: string,
  selection: SignatureConfirmationSelection,
  userId: string | null
) {
  const requestIds = [...new Set((selection.requestIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (!requestIds.length && selection.allPendingSignature !== true) {
    throw new Error("Indica las facturas o confirma todas las pendientes de firma");
  }

  const requests = await prisma.sepaRemittanceRequest.findMany({
    where: {
      workspaceId,
      archivedAt: null,
      OR: [
        ...(requestIds.length ? [{ id: { in: requestIds } }] : []),
        ...(selection.allPendingSignature === true ? [{ status: "PENDING_SIGNATURE" as const }] : [])
      ]
    },
    select: { id: true, invoiceNumber: true, status: true, archivedAt: true }
  });
  const jobs = requests.length ? await prisma.remittanceJob.findMany({
    where: { workspaceId, remittanceRequestId: { in: requests.map((request) => request.id) } },
    select: { remittanceRequestId: true, status: true }
  }) : [];
  const jobsByRequest = new Map<string, string[]>();
  for (const job of jobs) jobsByRequest.set(job.remittanceRequestId, [...(jobsByRequest.get(job.remittanceRequestId) ?? []), job.status]);
  const selected = selectSignatureConfirmations(requests.map((request) => ({
    ...request,
    jobStatuses: jobsByRequest.get(request.id) ?? []
  })), {
    requestIds,
    allPendingSignature: selection.allPendingSignature
  });

  const confirmed: string[] = [];
  for (const request of selected) {
    const changed = await prisma.$transaction(async (tx) => {
      const changed = await tx.sepaRemittanceRequest.updateMany({
        where: {
          id: request.id,
          workspaceId,
          archivedAt: null,
          status: request.status as "PENDING_APPROVAL" | "PENDING_SIGNATURE"
        },
        data: { status: "SIGNED", lastError: null }
      });
      if (!changed.count) return false;
      await tx.sepaRemittanceEvent.create({
        data: {
          requestId: request.id,
          fromStatus: request.status,
          toStatus: "SIGNED",
          userId,
          note: "Firma confirmada por el administrador; no implica conciliación ni cobro"
        }
      });
      return true;
    });
    if (changed && request.invoiceNumber) confirmed.push(request.invoiceNumber);
  }
  return { confirmed: confirmed.length, invoiceNumbers: confirmed };
}
