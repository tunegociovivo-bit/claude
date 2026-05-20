/** POST /api/v1/gmb/clients/[id]/toggle → alterna active/paused */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { logGmbActivity } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, status: true, name: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const next = client.status === "active" ? "paused" : "active";
  await prisma.gmbClient.update({ where: { id: params.id }, data: { status: next } });
  await logGmbActivity({
    workspaceId: api.workspaceId,
    clientId: client.id,
    actionType: next === "paused" ? "paused" : "activated",
    description: `Ficha "${client.name}" ${next === "paused" ? "pausada" : "activada"}`
  });
  return NextResponse.json({ ok: true, status: next });
});
