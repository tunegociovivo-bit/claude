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
import { lockEditorialEdit, syncPublicationEdit } from "@/lib/editorial/sync-publication-edit";

const schema = z.object({
  scheduledFor: z.string().datetime()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  await prisma.$transaction(async (tx) => {
    const locked = await lockEditorialEdit(tx, params.id, api.workspaceId);
    const data = { scheduledFor: new Date(parsed.data.scheduledFor) };
    await syncPublicationEdit(tx, locked, data, api.userId);
    const updated = await tx.editorialPost.update({ where: { id: params.id }, data });
    await tx.editorialRevision.create({ data: {
      postId: params.id, authorId: api.userId ?? null,
      body: JSON.stringify({ before: locked.post, after: updated }),
      changeSummary: "Fecha cambiada desde el calendario"
    } });
  });
  return NextResponse.json({ ok: true });
});
