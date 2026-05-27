import EquipoClient from "@/components/equipo/EquipoClient";
import { getTasksForUi, getTeamForUi } from "@/lib/db/queries";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { requireFeature } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export default async function EquipoPage() {
  await requireFeature("equipo");
  const [tasks, team, session] = await Promise.all([
    getTasksForUi(),
    getTeamForUi(),
    getServerSession(authOptions)
  ]);
  const userId = (session?.user as any)?.id ?? null;

  // Mapa userId → role para filtrar el calendario de tareas comunes:
  // se muestran tareas asignadas a TRABAJADORES (no-admins). Si en una
  // tarea sólo hay administradores asignados, se oculta — esas son
  // "tareas internas del admin" según la regla del usuario.
  const workspaceId = (session?.user as any)?.workspaceId;
  const memberships = workspaceId
    ? await prisma.membership.findMany({ where: { workspaceId }, select: { userId: true, role: true } })
    : [];
  const roleByUser: Record<string, "ADMIN" | "MEMBER" | "GUEST"> = {};
  memberships.forEach((m) => {
    roleByUser[m.userId] = m.role as any;
  });

  const teamTasks = tasks.filter((t) => {
    if (!t.assigneeIds || t.assigneeIds.length === 0) return false;
    if (!t.dueDate) return false;
    // Hay al menos un asignado no-admin → sí se muestra
    return t.assigneeIds.some((uid) => roleByUser[uid] && roleByUser[uid] !== "ADMIN");
  });

  return <EquipoClient team={team} teamTasks={teamTasks} currentUserId={userId} />;
}
