/**
 * Notificaciones de "te han asignado a una tarea". Se usa tanto desde
 * el POST de creación como desde el PATCH (cuando cambian assignees).
 * Crea Notification + dispara web push best-effort. No bloquea.
 */

import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/web-push";

export async function notifyAssignment(opts: {
  taskId: string;
  taskTitle: string;
  newAssigneeIds: string[];
  actorId: string | null | undefined;
}): Promise<void> {
  const targets = opts.newAssigneeIds.filter((id) => id && id !== opts.actorId);
  if (targets.length === 0) return;

  // Nombre del actor para la notificación, una sola query.
  let actorName: string | null = null;
  if (opts.actorId) {
    const a = await prisma.user.findUnique({
      where: { id: opts.actorId },
      select: { name: true }
    });
    actorName = a?.name ?? null;
  }

  const body = `${actorName ?? "Alguien"} te asignó "${opts.taskTitle}"`;
  const link = `/tareas?task=${opts.taskId}`;

  await prisma.notification.createMany({
    data: targets.map((uid) => ({ userId: uid, type: "assignment", body, link }))
  });
  await Promise.all(
    targets.map((uid) =>
      sendPushToUser(uid, {
        title: "Tarea asignada",
        body,
        link,
        tag: `assignment-${opts.taskId}`
      }).catch((e) => console.warn("[push] assignment fallo:", e?.message ?? e))
    )
  );
}
