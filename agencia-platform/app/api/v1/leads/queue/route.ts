import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const where: any = { workspaceId: api.workspaceId };
  if (status) where.status = status;
  const items = await prisma.leadMessage.findMany({
    where,
    orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
    take: 200
  });
  return NextResponse.json({ items });
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500)
});

/** Borrado masivo de la cola. Excluye mensajes en estado "sending" para no
 *  abortar un envío en curso. */
export const DELETE = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const out = await prisma.leadMessage.deleteMany({
    where: {
      id: { in: parsed.data.ids },
      workspaceId: api.workspaceId,
      status: { not: "sending" }
    }
  });
  return NextResponse.json({ deleted: out.count });
});
