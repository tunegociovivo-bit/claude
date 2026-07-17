/**
 * Publicador de Google Posts programados.
 *
 * Busca los GmbPost en estado "scheduled" cuya fecha ya venció y los publica en
 * la ficha de Google (gmbCreatePost). Es el motor que faltaba: hasta ahora los
 * posts se creaban con scheduledAt/status="scheduled" pero nada los publicaba.
 * Lo dispara el planificador interno (in-app-scheduler) cada ~5 min.
 */

import { prisma } from "@/lib/db/prisma";
import { gmbCreatePost } from "@/lib/integrations/gmb";
import { logError } from "@/lib/monitoring/error-log";

export async function publishScheduledGmbPosts(): Promise<{ published: number; failed: number }> {
  const now = new Date();
  const due = await prisma.gmbPost.findMany({
    where: { status: "scheduled", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 20
  });

  let published = 0;
  let failed = 0;
  for (const p of due) {
    try {
      const cta = (p.cta || "").trim();
      await gmbCreatePost({
        workspaceId: p.workspaceId,
        clientId: p.clientId,
        summary: p.content,
        mediaUrl: p.imageUrl || undefined,
        // Solo mandamos CTA si el campo es una URL válida (LEARN_MORE con enlace).
        callToAction: /^https?:\/\//i.test(cta) ? { actionType: "LEARN_MORE", url: cta } : undefined
      });
      await prisma.gmbPost.update({
        where: { id: p.id },
        data: { status: "published", publishedAt: new Date() }
      });
      published++;
    } catch (e) {
      failed++;
      logError("gmb:publish-scheduled", e, p.workspaceId);
      await prisma.gmbPost.update({ where: { id: p.id }, data: { status: "failed" } }).catch(() => {});
    }
  }
  return { published, failed };
}
