import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  phone: z.string().nullable().optional(),
  image: z.string().url().nullable().optional(),
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]).optional()
});

async function requireAdminInWorkspace(workspaceId: string, userId: string) {
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins pueden hacer esto");
}

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await requireAdminInWorkspace(api.workspaceId, api.userId);

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { name, email, password, role, phone, image } = parsed.data;

  const member = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: params.id }
  });
  if (!member) throw new ApiError(404, "not_found", "Usuario no es miembro del workspace");

  const userUpdate: any = {};
  if (name !== undefined) userUpdate.name = name;
  if (email !== undefined) userUpdate.email = email;
  if (phone !== undefined) userUpdate.phone = phone;
  if (image !== undefined) userUpdate.image = image;
  if (password) userUpdate.passwordHash = await bcrypt.hash(password, 10);

  if (Object.keys(userUpdate).length > 0) {
    await prisma.user.update({ where: { id: params.id }, data: userUpdate });
  }
  if (role) {
    await prisma.membership.update({ where: { id: member.id }, data: { role } });
  }

  const updated = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, image: true }
  });
  return NextResponse.json({ ...updated, role: role ?? member.role });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await requireAdminInWorkspace(api.workspaceId, api.userId);
  if (params.id === api.userId) throw new ApiError(400, "cant_remove_self", "No puedes eliminarte a ti mismo");

  const member = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: params.id }
  });
  if (!member) throw new ApiError(404, "not_found", "Usuario no es miembro del workspace");

  await prisma.membership.delete({ where: { id: member.id } });
  return NextResponse.json({ ok: true });
});
