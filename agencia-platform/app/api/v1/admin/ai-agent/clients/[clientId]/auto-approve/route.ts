/**
 * GET  /api/v1/admin/ai-agent/clients/:clientId/auto-approve
 * PUT  /api/v1/admin/ai-agent/clients/:clientId/auto-approve
 *      body: { kinds: string[] }  // EMAIL, WHATSAPP, EDITORIAL_POST, CALENDAR_EVENT, DRIVE_FILE
 *
 * Lee/define qué tipos de draft de Sonia se auto-aprueban en este
 * cliente. Mientras la lista esté vacía, todo draft requiere
 * revisión humana (comportamiento por defecto, seguro).
 *
 * Solo admin. Pensado para activar tras observar tasa de aprobación
 * alta en el dashboard /admin/nv-ia/insights — un cliente con 95%
 * de aprobación en EMAIL es candidato para auto-aprobar EMAIL.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

const VALID_KINDS = ["EMAIL", "WHATSAPP", "EDITORIAL_POST", "CALENDAR_EVENT", "DRIVE_FILE"];

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const client = await prisma.client.findFirst({
    where: { id: params.clientId, workspaceId: api.workspaceId },
    select: { id: true, name: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");
  const mem = await prisma.aiClientMemory.findUnique({
    where: { clientId: params.clientId },
    select: { autoApproveDraftKinds: true }
  });
  return NextResponse.json({
    client,
    autoApproveDraftKinds: mem?.autoApproveDraftKinds ?? []
  });
});

const putSchema = z.object({
  kinds: z.array(z.enum(["EMAIL", "WHATSAPP", "EDITORIAL_POST", "CALENDAR_EVENT", "DRIVE_FILE"]))
});

export const PUT = withApi({ scope: "*", rate: "destructive" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const client = await prisma.client.findFirst({
    where: { id: params.clientId, workspaceId: api.workspaceId }
  });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");

  // Dedupe + validación
  const kinds = Array.from(new Set(parsed.data.kinds.filter((k) => VALID_KINDS.includes(k))));

  await prisma.aiClientMemory.upsert({
    where: { clientId: params.clientId },
    create: {
      workspaceId: api.workspaceId,
      clientId: params.clientId,
      content: "",
      autoApproveDraftKinds: kinds,
      updatedBy: `user:${api.userId}`
    },
    update: {
      autoApproveDraftKinds: kinds,
      updatedBy: `user:${api.userId}`
    }
  });

  return NextResponse.json({ ok: true, autoApproveDraftKinds: kinds });
});
