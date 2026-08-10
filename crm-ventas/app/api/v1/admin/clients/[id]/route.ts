import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireOperator } from "@/lib/auth";
import { normalizeAdminNotes, normalizeClientName } from "@/lib/admin/usage";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const changesBlock = typeof body.isBlocked === "boolean";
  const changesNotes = typeof body.adminNotes === "string";
  const changesName = typeof body.name === "string";
  const name = changesName ? normalizeClientName(body.name) : "";
  if (changesName && !name) return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
  if (!changesBlock && !changesNotes && !changesName) return NextResponse.json({ error: "No hay cambios válidos" }, { status: 400 });
  const workspace = await prisma.workspace.update({
    where: { id: params.id },
    data: {
      ...(changesBlock ? { isBlocked: body.isBlocked, blockedAt: body.isBlocked ? new Date() : null } : {}),
      ...(changesNotes ? { adminNotes: normalizeAdminNotes(body.adminNotes) || null } : {}),
      ...(changesName ? { name } : {}),
    },
    select: { id: true, name: true, isBlocked: true, adminNotes: true },
  });
  return NextResponse.json({ ok: true, workspace });
}
