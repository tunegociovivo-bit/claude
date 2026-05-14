import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";

export const GET = withApi({ scope: "admin" }, async (_req, { params, api }) => {
  const job = await prisma.asanaImport.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!job) throw new ApiError(404, "not_found", "Importación no encontrada");
  return NextResponse.json(job);
});
