import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { FEATURES } from "@/lib/features";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  phone: z.string().nullable().optional(),
  image: z.string().url().nullable().optional(),
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]).optional(),
  // null = se aplican los defaults del rol. Array = sólo esas features.
  features: z.array(z.enum(FEATURES as unknown as [string, ...string[]])).nullable().optional()
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

  const { name, email, password, role, phone, image, features } = parsed.data;

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
  const membershipUpdate: any = {};
  if (role) membershipUpdate.role = role;
  if (features !== undefined) membershipUpdate.features = features; // array | null
  if (Object.keys(membershipUpdate).length > 0) {
    await prisma.membership.update({ where: { id: member.id }, data: membershipUpdate });
  }

  const updated = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, image: true }
  });
  return NextResponse.json({ ...updated, role: role ?? member.role });
});

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await requireAdminInWorkspace(api.workspaceId, api.userId);
  if (params.id === api.userId) throw new ApiError(400, "cant_remove_self", "No puedes eliminarte a ti mismo");

  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "true";

  // 1) Quitar la membership del workspace (idempotente: si no existe,
  //    no es error — quizá ya se quitó o el user quedó huérfano).
  const members = await prisma.membership.findMany({
    where: { workspaceId: api.workspaceId, userId: params.id }
  });
  if (members.length > 0) {
    await prisma.membership.deleteMany({
      where: { workspaceId: api.workspaceId, userId: params.id }
    });
  }

  // 2) Borrado "soft" (default): solo se quita del workspace. El User
  //    sigue existiendo (puede estar en otros workspaces, conserva su
  //    histórico). Esto es lo que el 99% de las veces se quiere.
  if (!hard) {
    // Si el user NO tenía membership y tampoco pertenece a otro
    // workspace, igualmente devolvemos ok — no hay nada que romper.
    return NextResponse.json({ ok: true, removedFromWorkspace: members.length > 0 });
  }

  // 3) Borrado "hard": eliminar el User por completo. Antes hay que
  //    desvincular su contenido (tasks asignadas, comentarios, etc.)
  //    para no violar FKs. Reasignamos a null en vez de borrar el
  //    contenido — no queremos perder tareas/comentarios reales.
  try {
    // Solo permitimos hard delete si el user NO está en otros workspaces
    // (sería peligroso borrarlo globalmente desde aquí).
    const otherMemberships = await prisma.membership.count({
      where: { userId: params.id }
    });
    if (otherMemberships > 0) {
      throw new ApiError(
        409,
        "in_other_workspaces",
        "Este usuario pertenece a otros workspaces. Solo se ha quitado de este. Para borrarlo globalmente, quítalo primero de los demás."
      );
    }

    // Desvincular contenido del workspace que apunta a este user.
    // assignees de tareas:
    await prisma.taskAssignee.deleteMany({ where: { userId: params.id } }).catch(() => {});
    // sesiones / cuentas auth:
    await prisma.session.deleteMany({ where: { userId: params.id } }).catch(() => {});
    await prisma.account.deleteMany({ where: { userId: params.id } }).catch(() => {});
    await prisma.userSession.deleteMany({ where: { userId: params.id } }).catch(() => {});
    await prisma.asanaConnection.deleteMany({ where: { userId: params.id } }).catch(() => {});

    // Finalmente el User. Las relaciones con onDelete: SetNull (comments
    // author, project manager, etc.) se anulan solas; las Cascade se
    // limpian. Si alguna FK Restrict bloquea, lo reportamos claro.
    await prisma.user.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true, hardDeleted: true });
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e?.code === "P2003" || e?.code === "P2014") {
      throw new ApiError(
        409,
        "has_content",
        "El usuario tiene contenido vinculado que impide el borrado completo. Se ha quitado del workspace pero su cuenta global permanece."
      );
    }
    throw new ApiError(500, "delete_failed", `No se pudo eliminar: ${String(e?.message ?? e).slice(0, 200)}`);
  }
});
