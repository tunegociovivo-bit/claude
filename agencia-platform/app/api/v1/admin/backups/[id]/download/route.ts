/**
 * Stream del JSON de backup. Si está en R2, redirige a la URL firmada.
 * Si no, regenera el dump al vuelo (siempre el más actual del workspace).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateWorkspaceDump } from "@/lib/backup/dump";
import { isStorageEnabled, signedDownloadUrl } from "@/lib/storage/r2";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");

  const run = await prisma.backupRun.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!run) throw new ApiError(404, "not_found", "Backup no encontrado");

  if (run.downloadKey && isStorageEnabled()) {
    const url = await signedDownloadUrl(run.downloadKey);
    return NextResponse.redirect(url);
  }

  // Sin storage o sin key: regeneramos al vuelo y servimos inline
  const dump = await generateWorkspaceDump(api.workspaceId);
  const json = JSON.stringify(dump, null, 2);
  return new NextResponse(json, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="backup-${run.workspaceId}-${run.id}.json"`
    }
  });
});
