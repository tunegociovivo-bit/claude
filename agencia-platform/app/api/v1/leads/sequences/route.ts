import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.leadSequence.findMany({
    where: { workspaceId: api.workspaceId },
    include: { steps: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "asc" }
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  steps: z
    .array(
      z.object({
        order: z.number().int().min(0),
        delayDays: z.number().int().min(0).default(0),
        delayHours: z.number().int().min(0).optional(),
        templateBody: z.string().min(1),
        channel: z.string().default("whatsapp"),
        stopIfResponded: z.boolean().default(true)
      })
    )
    .min(1)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const seq = await prisma.leadSequence.create({
    data: {
      workspaceId: api.workspaceId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      active: parsed.data.active,
      isDefault: parsed.data.isDefault,
      steps: {
        create: parsed.data.steps.map((s) => ({
          order: s.order,
          delayDays: s.delayDays,
          delayHours: s.delayHours ?? s.delayDays * 24,
          templateBody: s.templateBody,
          channel: s.channel,
          stopIfResponded: s.stopIfResponded
        }))
      }
    },
    include: { steps: true }
  });
  return NextResponse.json(seq, { status: 201 });
});
