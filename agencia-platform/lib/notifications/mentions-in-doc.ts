/**
 * Notificación cuando alguien te menciona en la descripción rich de
 * una tarea o en el cuerpo de un documento. Complementa la notif
 * de menciones en comentarios (ya existente en
 * /api/v1/tasks/[id]/comments) y de asignaciones de tarea.
 *
 * El diff de menciones es lo que importa: si el doc tenía X mencionado
 * antes y sigue ahí, no se vuelve a notificar. Solo los nuevos.
 */

import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/web-push";
import { extractMentionUserIds } from "@/lib/mentions";

type Source = {
  kind: "task" | "document";
  id: string;
  title: string;
  workspaceId: string;
};

export async function notifyNewMentions(opts: {
  source: Source;
  previousBody: any;
  nextBody: any;
  actorId: string | null | undefined;
}): Promise<void> {
  const prevIds = new Set(extractFromAny(opts.previousBody));
  const nextIds = extractFromAny(opts.nextBody);
  const added = nextIds.filter((id) => !prevIds.has(id) && id !== opts.actorId);
  if (added.length === 0) return;

  // Filtra a usuarios que sigan siendo miembros del workspace.
  const valid = await prisma.user.findMany({
    where: {
      id: { in: added },
      memberships: { some: { workspaceId: opts.source.workspaceId } }
    },
    select: { id: true }
  });
  if (valid.length === 0) return;

  let actorName: string | null = null;
  if (opts.actorId) {
    const a = await prisma.user.findUnique({
      where: { id: opts.actorId },
      select: { name: true }
    });
    actorName = a?.name ?? null;
  }

  const where = opts.source.kind === "task" ? "la tarea" : "el documento";
  const body = `${actorName ?? "Alguien"} te mencionó en ${where} "${opts.source.title}"`;
  const link =
    opts.source.kind === "task"
      ? `/tareas?task=${opts.source.id}`
      : `/documentos/${opts.source.id}`;

  await prisma.notification.createMany({
    data: valid.map((u) => ({ userId: u.id, type: "mention", body, link }))
  });
  await Promise.all(
    valid.map((u) =>
      sendPushToUser(u.id, {
        title: "Te han mencionado",
        body,
        link,
        tag: `mention-${opts.source.kind}-${opts.source.id}`
      }).catch((e) => console.warn("[push] mention fallo:", e?.message ?? e))
    )
  );
}

function extractFromAny(body: any): string[] {
  if (!body) return [];
  // Acepta tanto un string serializado como un objeto TipTap.
  if (typeof body === "string") return extractMentionUserIds(body);
  try {
    return extractMentionUserIds(JSON.stringify(body));
  } catch {
    return [];
  }
}
