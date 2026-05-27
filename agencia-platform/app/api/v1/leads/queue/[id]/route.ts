import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const DELETE = withApi({ scope: "*" }, async (_req, { api, params }) => {
  const id = (params as any)?.id as string;
  if (!id) throw new ApiError(400, "missing_id", "Falta id");
  const msg = await prisma.leadMessage.findFirst({
    where: { id, workspaceId: api.workspaceId },
    select: { id: true, status: true }
  });
  if (!msg) throw new ApiError(404, "not_found", "Mensaje no encontrado");
  if (msg.status === "sending") {
    throw new ApiError(409, "in_flight", "Mensaje en envío; espera a que termine");
  }
  await prisma.leadMessage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
