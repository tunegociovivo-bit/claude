import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "IMPLEMENTED"]),
  note: z.string().max(2000).optional(),
  implementationRef: z.string().max(500).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const updated = await prisma.aiProposedTool.update({
    where: { id: params.id },
    data: {
      status: parsed.data.status,
      reviewedById: api.userId,
      reviewedAt: new Date(),
      reviewerNote: parsed.data.note ?? null,
      implementationRef: parsed.data.implementationRef ?? null
    }
  });
  return NextResponse.json({ ok: true, item: updated });
});
