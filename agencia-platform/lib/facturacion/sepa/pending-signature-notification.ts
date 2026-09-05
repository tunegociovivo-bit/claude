import { prisma } from "@/lib/db/prisma";
import { notifyJobEmail } from "./remittance";

/**
 * Reserva atómicamente el aviso final de una solicitud. De este modo, dos
 * ejecuciones del agente o una recuperación manual concurrente no pueden enviar
 * el mismo correo. Si el proveedor rechaza el envío, libera la reserva para que
 * el siguiente intento pueda recuperarlo.
 */
export async function notifyPendingSignatureRequestOnce(workspaceId: string, requestId: string): Promise<boolean> {
  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - 10 * 60 * 1000);
  const claim = await prisma.sepaRemittanceRequest.updateMany({
    where: {
      id: requestId,
      workspaceId,
      status: "PENDING_SIGNATURE",
      archivedAt: null,
      pendingSignatureNotifiedAt: null,
      OR: [
        { pendingSignatureNotificationClaimedAt: null },
        { pendingSignatureNotificationClaimedAt: { lt: staleBefore } }
      ]
    },
    data: { pendingSignatureNotificationClaimedAt: claimedAt }
  });
  if (claim.count === 0) return false;

  const row = await prisma.sepaRemittanceRequest.findUnique({
    where: { id: requestId },
    select: { clientName: true, invoiceNumber: true, amountCents: true, currency: true }
  });
  if (!row) return false;

  try {
    await notifyJobEmail("pending_signature", { ...row, notificationKey: `sepa-pending-signature-${workspaceId}-${requestId}` }, workspaceId);
    await prisma.sepaRemittanceRequest.updateMany({
      where: { id: requestId, workspaceId, pendingSignatureNotificationClaimedAt: claimedAt },
      data: { pendingSignatureNotifiedAt: new Date(), pendingSignatureNotificationClaimedAt: null }
    });
    return true;
  } catch (error) {
    await prisma.sepaRemittanceRequest.updateMany({
      where: { id: requestId, workspaceId, pendingSignatureNotificationClaimedAt: claimedAt },
      data: { pendingSignatureNotificationClaimedAt: null }
    });
    throw error;
  }
}
