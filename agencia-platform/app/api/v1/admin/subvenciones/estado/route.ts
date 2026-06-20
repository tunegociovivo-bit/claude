/**
 * POST /api/v1/admin/subvenciones/estado
 * Body: { clientId, convocatoriaId, estado }
 * Guarda el estado de gestión de una convocatoria para un cliente.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().min(1),
  convocatoriaId: z.string().min(1),
  estado: z.enum(["interesa", "en_proceso", "presentada", "descartada"])
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { clientId, convocatoriaId, estado } = parsed.data;

  // Verifica que el cliente es del workspace.
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId: api.workspaceId }, select: { id: true } });
  if (!client) throw new ApiError(404, "no_client", "Cliente no encontrado");

  const row = await prisma.subvencionEstado.upsert({
    where: { workspaceId_clientId_convocatoriaId: { workspaceId: api.workspaceId, clientId, convocatoriaId } },
    create: { workspaceId: api.workspaceId, clientId, convocatoriaId, estado },
    update: { estado }
  });
  return NextResponse.json({ ok: true, estado: row.estado });
});
