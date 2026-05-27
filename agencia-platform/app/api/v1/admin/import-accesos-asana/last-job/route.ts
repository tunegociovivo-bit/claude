/**
 * GET /api/v1/admin/import-accesos-asana/last-job
 *
 * Devuelve el último BackgroundJob de kind admin.import_accesos_asana
 * del workspace, con su status/result/events. Permite que la página de
 * import muestre lo que pasó la última vez aunque el usuario se haya
 * ido y vuelto a entrar.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const job = await prisma.backgroundJob.findFirst({
    where: {
      workspaceId: api.workspaceId,
      kind: "admin.import_accesos_asana"
    },
    orderBy: { createdAt: "desc" }
  });
  if (!job) return NextResponse.json({ job: null });
  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      progressPct: job.progressPct,
      progressMsg: job.progressMsg,
      result: job.result,
      events: job.events,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      completedAt: job.completedAt
    }
  });
});
