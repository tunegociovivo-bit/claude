/**
 * GET /api/v1/admin/ai-agent/memory
 *
 * Lista todos los clientes del workspace con un resumen (tamaño +
 * última actualización) de la memoria que NV IA tiene de cada uno.
 * Solo admin. Incluye clientes SIN memoria — para que el admin pueda
 * "abrir" memoria nueva si quiere preseed manual.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const clients = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { name: "asc" },
    include: {
      aiMemory: { select: { content: true, updatedAt: true, updatedBy: true } }
    }
  });
  return NextResponse.json({
    items: clients.map((c: any) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      hasMemory: !!c.aiMemory && c.aiMemory.content.length > 0,
      sizeBytes: c.aiMemory?.content?.length ?? 0,
      updatedAt: c.aiMemory?.updatedAt ?? null,
      updatedBy: c.aiMemory?.updatedBy ?? null
    }))
  });
});
