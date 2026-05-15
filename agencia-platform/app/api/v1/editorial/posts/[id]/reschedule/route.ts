/**
 * POST /api/v1/editorial/posts/[id]/reschedule
 * Body: { scheduledFor: ISO datetime }
 *
 * Endpoint dedicado para drag&drop en el calendario.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({
  scheduledFor: z.string().datetime()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const updated = await prisma.editorialPost.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: { scheduledFor: new Date(parsed.data.scheduledFor) }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Publicación no encontrada");
  return NextResponse.json({ ok: true });
});
