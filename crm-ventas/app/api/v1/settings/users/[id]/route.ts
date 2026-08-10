import { Prisma } from "@prisma/client";
import {
  forbidden,
  isSameOrigin,
  requireWorkspaceAdmin,
  unauthorized,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

class DeleteUserError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId, userId } = await requireWorkspaceAdmin();
    const targetId = params.id;

    // Transacción Serializable: el recuento de admins y el borrado son
    // atómicos frente a eliminaciones concurrentes (no puede quedarse el
    // workspace sin ningún admin por una carrera).
    await prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findFirst({
          where: { id: targetId, workspaceId },
          select: { id: true, role: true },
        });
        if (!target) throw new DeleteUserError("Usuario no encontrado", 404);
        if (target.id === userId) {
          throw new DeleteUserError("No puedes eliminar tu propio usuario", 400);
        }
        if (target.role === "ADMIN") {
          const admins = await tx.user.count({
            where: { workspaceId, role: "ADMIN" },
          });
          if (admins <= 1) {
            throw new DeleteUserError(
              "No se puede eliminar el último administrador",
              400
            );
          }
        }
        await tx.user.delete({ where: { id: target.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return Response.json({ ok: true });
  } catch (error) {
    if ((error as Error)?.message === "UNAUTHORIZED") return unauthorized();
    if ((error as Error)?.message === "FORBIDDEN") return forbidden();
    if (error instanceof DeleteUserError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "No se pudo eliminar el usuario" }, { status: 500 });
  }
}
