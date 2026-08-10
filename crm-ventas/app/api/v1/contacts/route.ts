import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceId, unauthorized } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  stage: z.string().default("nuevos"),
  notes: z.string().optional(),
});

export async function GET() {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const contacts = await prisma.contact.findMany({
    where: { workspaceId },
    orderBy: [{ stage: "asc" }, { order: "asc" }, { createdAt: "desc" }],
    include: {
      appointments: {
        where: { status: { not: "cancelada" }, startsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 1,
        select: { startsAt: true },
      },
    },
  });
  return NextResponse.json({ contacts });
}

export async function POST(req: NextRequest) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      name: d.name,
      phone: d.phone ? normalizePhone(d.phone) : null,
      email: d.email || null,
      stage: d.stage,
      notes: d.notes,
      source: "manual",
    },
  });
  return NextResponse.json({ contact }, { status: 201 });
}
