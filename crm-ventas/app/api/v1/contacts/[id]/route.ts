import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireWorkspaceId, unauthorized } from "@/lib/auth";
import { getLeadsState } from "@/lib/leads/settings";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  stage: z.string().optional(),
  notes: z.string().max(10000).nullable().optional(),
  // Estado del lead (módulo «Leads y reenvíos»): id de la lista de Ajustes o null.
  leadStatus: z.string().max(60).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { leadStatus, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (leadStatus !== undefined) {
    const leads = await getLeadsState(workspaceId);
    if (!leads.enabled) return NextResponse.json({ error: "El módulo de leads no está activo" }, { status: 403 });
    if (leadStatus !== null && !leads.statuses.some((s) => s.id === leadStatus)) {
      return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
    }
    data.leadStatus = leadStatus;
    data.leadStatusAt = new Date();
  }
  const result = await prisma.contact.updateMany({
    where: { id: params.id, workspaceId },
    data,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const result = await prisma.contact.deleteMany({
    where: { id: params.id, workspaceId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
