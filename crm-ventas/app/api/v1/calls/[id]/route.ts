import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireWorkspaceId, unauthorized } from "@/lib/auth";

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  if (!isSameOrigin(request)) return unauthorized();
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const active = await prisma.call.findFirst({
    where: { id: params.id, workspaceId, status: "en-curso" },
    select: { id: true },
  });
  if (active) {
    return NextResponse.json(
      { error: "Espera a que termine la llamada para eliminarla" },
      { status: 409 }
    );
  }
  const result = await prisma.call.deleteMany({ where: { id: params.id, workspaceId } });
  if (!result.count) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
