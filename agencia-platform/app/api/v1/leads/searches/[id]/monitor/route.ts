/**
 * POST /api/v1/leads/searches/[id]/monitor  { monitored: boolean }
 *
 * Activa/desactiva la monitorización continua de una búsqueda. Cuando está
 * activa, el cron leads-monitor la revisa periódicamente para detectar
 * negocios nuevos y caídas de rating.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({ monitored: z.boolean() });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const r = await prisma.leadSearch.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: { monitored: parsed.data.monitored }
  });
  if (r.count === 0) throw new ApiError(404, "not_found", "Búsqueda no encontrada");
  return NextResponse.json({ ok: true, monitored: parsed.data.monitored });
});
