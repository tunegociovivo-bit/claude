import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  forbidden,
  isSameOrigin,
  requireWorkspaceAdmin,
  unauthorized,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} as const;

function authError(error: unknown) {
  if ((error as Error)?.message === "UNAUTHORIZED") return unauthorized();
  if ((error as Error)?.message === "FORBIDDEN") return forbidden();
  return null;
}

// Usuarios del workspace ACTUAL. El workspaceId sale siempre de la sesión;
// nunca del cliente.
export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAdmin();
    const users = await prisma.user.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: userSelect,
    });
    return Response.json({ users });
  } catch (error) {
    return authError(error) || Response.json({ error: "Error interno" }, { status: 500 });
  }
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).optional(),
  password: z.string().min(8).max(200),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId } = await requireWorkspaceAdmin();
    const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: "Revisa los datos: email válido, contraseña de 8+ caracteres y rol" },
        { status: 400 }
      );
    }
    const { email, name, password, role } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { workspaceId, email, name: name || null, passwordHash, role },
      select: userSelect,
    });
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    const auth = authError(error);
    if (auth) return auth;
    if ((error as any)?.code === "P2002") {
      return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
    }
    return Response.json({ error: "No se pudo crear el usuario" }, { status: 500 });
  }
}
