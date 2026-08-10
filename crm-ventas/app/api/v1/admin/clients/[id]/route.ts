import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireOperator } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.isBlocked !== "boolean") return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
  const workspace = await prisma.workspace.update({
    where: { id: params.id },
    data: { isBlocked: body.isBlocked, blockedAt: body.isBlocked ? new Date() : null },
    select: { id: true, isBlocked: true },
  });
  return NextResponse.json({ ok: true, workspace });
}
