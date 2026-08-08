import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireWorkspaceId, unauthorized } from "@/lib/auth";

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return unauthorized();
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const result = await prisma.call.deleteMany({
    where: { workspaceId, status: { not: "en-curso" } },
  });
  return NextResponse.json({ ok: true, deleted: result.count });
}
