import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { assertSameOrigin } from "@/lib/api/csrf";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export const DELETE = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const id = String(params?.id ?? "").trim();
  if (!id) throw new ApiError(400, "missing_id", "Falta la solicitud de remesa");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "SepaRemittanceRequest" WHERE "id" = ${id} AND "workspaceId" = ${api.workspaceId} FOR UPDATE`;
    const request = await tx.sepaRemittanceRequest.findFirst({
      where: { id, workspaceId: api.workspaceId, archivedAt: null },
      select: { id: true, status: true }
    });
    if (!request) throw new ApiError(404, "not_found", "Solicitud no encontrada");

    const job = await tx.remittanceJob.findFirst({
      where: { remittanceRequestId: id, workspaceId: api.workspaceId },
      select: { id: true, status: true }
    });
    if (job && ["PENDING", "CLAIMED", "RUNNING", "NEEDS_USER"].includes(job.status)) {
      throw new ApiError(409, "job_active", "La remesa tiene una tarea bancaria activa. Cancélala o espera a que termine antes de eliminarla.");
    }

    // Eliminación lógica: desaparece del listado, pero conserva solicitud,
    // eventos y trabajo bancario para no romper auditoría ni crear huérfanos.
    const archived = await tx.sepaRemittanceRequest.updateMany({
      where: { id, workspaceId: api.workspaceId, archivedAt: null },
      data: { archivedAt: new Date(), archivedById: api.userId, tokenUsedAt: new Date() }
    });
    if (archived.count !== 1) throw new ApiError(409, "delete_conflict", "La solicitud cambió mientras se eliminaba");
  });

  return NextResponse.json({ ok: true });
});
