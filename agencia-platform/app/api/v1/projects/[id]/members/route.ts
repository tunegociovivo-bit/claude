import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const addMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]).default("MEMBER")
});

async function requireAdminInWorkspace(workspaceId: string, userId: string) {
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins del workspace pueden gestionar miembros de proyecto");
}

export const GET = withApi({ scope: "projects:read" }, async (_req, { params, api }) => {
  const project = await prisma.project.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!project) throw new ApiError(404, "not_found", "Proyecto no encontrado");

  const members = await prisma.projectMember.findMany({
    where: { projectId: params.id },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { addedAt: "asc" }
  });

  return NextResponse.json({
    items: members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      role: m.role,
      addedAt: m.addedAt
    }))
  });
});

export const POST = withApi({ scope: "projects:write" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await requireAdminInWorkspace(api.workspaceId, api.userId);

  const project = await prisma.project.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!project) throw new ApiError(404, "not_found", "Proyecto no encontrado");

  const body = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // El usuario debe ser miembro del workspace
  const ws = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: parsed.data.userId }
  });
  if (!ws) throw new ApiError(400, "not_in_workspace", "Ese usuario no pertenece al workspace");

  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: params.id, userId: parsed.data.userId } }
  });
  if (existing) {
    const updated = await prisma.projectMember.update({
      where: { id: existing.id },
      data: { role: parsed.data.role }
    });
    return NextResponse.json(updated);
  }

  const created = await prisma.projectMember.create({
    data: {
      projectId: params.id,
      userId: parsed.data.userId,
      role: parsed.data.role
    }
  });
  return NextResponse.json(created, { status: 201 });
});
