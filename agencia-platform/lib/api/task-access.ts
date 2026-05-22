import { prisma } from "@/lib/db/prisma";

/**
 * Cláusula Prisma de VISIBILIDAD DE TAREAS para un usuario.
 *
 * Política (pedida por el dueño del workspace): un trabajador NO puede ver
 * las tareas de otro salvo que:
 *   - la tarea esté ASIGNADA a él (por su nombre), o
 *   - la tarea esté en un PROYECTO al que tiene acceso (es miembro), ya sea
 *     como proyecto principal o compartida a ese proyecto (extraProjects).
 *
 * Devuelve:
 *   - `null` → el usuario ve TODO (es ADMIN). El caller no debe añadir filtro.
 *   - un objeto `where` parcial → mézclalo con AND en la query.
 *
 * IMPORTANTE: ya NO se aplica el modelo de "proyecto abierto" (sin miembros
 * = visible para todos), que filtraba tareas ajenas a cualquiera. Ahora el
 * acceso es explícito: o estás asignado, o eres miembro del proyecto.
 */
export async function taskVisibilityWhere(
  workspaceId: string,
  userId: string | null | undefined
): Promise<Record<string, unknown> | null> {
  if (!userId) {
    // Sin usuario identificado: por seguridad, nada visible.
    return { id: "__no_user__" };
  }
  const membership = await prisma.membership.findFirst({
    where: { workspaceId, userId },
    select: { role: true }
  });
  if (!membership) {
    // No pertenece al workspace → no ve nada.
    return { id: "__not_member__" };
  }
  if (membership.role === "ADMIN") return null; // ve todo

  return {
    OR: [
      { assignees: { some: { userId } } },
      { project: { members: { some: { userId } } } },
      { extraProjects: { some: { project: { members: { some: { userId } } } } } }
    ]
  };
}
