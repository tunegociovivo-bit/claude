import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]).default("MEMBER")
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  // Listamos miembros del workspace activo
  const memberships = await prisma.membership.findMany({
    where: { workspaceId: api.workspaceId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true, role: true, createdAt: true } }
    },
    orderBy: { joinedAt: "asc" }
  });

  const items = memberships.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role, // rol dentro del workspace
    globalRole: m.user.role,
    membershipId: m.id,
    joinedAt: m.joinedAt
  }));
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  // Solo admins del workspace pueden crear usuarios
  const me = await prisma.membership.findFirst({
    where: { userId: api.userId, workspaceId: api.workspaceId }
  });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins pueden crear usuarios");

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { email, name, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Si existe pero no es miembro del workspace, lo añadimos
    const m = await prisma.membership.findFirst({
      where: { workspaceId: api.workspaceId, userId: existing.id }
    });
    if (m) throw new ApiError(409, "already_member", "Este usuario ya es miembro del workspace");
    await prisma.membership.create({
      data: { workspaceId: api.workspaceId, userId: existing.id, role }
    });
    return NextResponse.json({ id: existing.id, email: existing.email, name: existing.name, role }, { status: 201 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      memberships: { create: [{ workspaceId: api.workspaceId, role }] }
    }
  });
  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name, role },
    { status: 201 }
  );
});
