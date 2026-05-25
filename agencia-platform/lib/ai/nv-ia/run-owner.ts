import { prisma } from "@/lib/db/prisma";

/**
 * Dueño efectivo de un AiAgentRun a efectos de avisos de voz de Sonia: el
 * usuario que encargó el trabajo.
 *
 * - Si el run tiene `requesterId` (un humano lo lanzó: enlazar al buzón de
 *   Sonia, comentario, reproceso…), ese es el dueño.
 * - Si NO lo tiene (runs automáticos: recurrentes, followups programados,
 *   relanzamientos post auto-fix), hereda el `requesterId` del último run
 *   CON dueño de la MISMA tarea — porque sigue siendo "su" tarea.
 * - Si la tarea nunca tuvo un run encargado por un humano (email/WhatsApp
 *   entrante, escaneos proactivos de leads/churn), devuelve null = aviso
 *   sin dueño, compartido entre admins.
 */
export async function resolveRunOwnerId(opts: {
  workspaceId: string;
  taskId: string | null;
  requesterId: string | null;
}): Promise<string | null> {
  if (opts.requesterId) return opts.requesterId;
  if (!opts.taskId) return null;
  const owned = await prisma.aiAgentRun.findFirst({
    where: {
      workspaceId: opts.workspaceId,
      taskId: opts.taskId,
      requesterId: { not: null }
    },
    orderBy: { createdAt: "desc" },
    select: { requesterId: true }
  });
  return owned?.requesterId ?? null;
}
