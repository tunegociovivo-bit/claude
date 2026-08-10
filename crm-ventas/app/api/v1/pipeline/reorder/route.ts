import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceId, unauthorized } from "@/lib/auth";

const schema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string(),
        stage: z.string(),
        order: z.number().int(),
      })
    )
    .max(500),
});

// Persiste el resultado de un drag & drop del kanban.
export async function POST(req: NextRequest) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await prisma.$transaction(
    parsed.data.updates.map((u) =>
      prisma.contact.updateMany({
        where: { id: u.id, workspaceId },
        data: { stage: u.stage, order: u.order },
      })
    )
  );
  return NextResponse.json({ ok: true });
}
