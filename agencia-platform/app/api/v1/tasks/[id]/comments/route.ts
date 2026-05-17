import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { extractMentionTokens, extractMentionUserIds, resolveMentions } from "@/lib/mentions";
import { sendPushToUser } from "@/lib/push/web-push";
import { toTipTapDoc, serializeForString } from "@/lib/comments/body";
import { indexEntity } from "@/lib/search/embeddings";
import { extractText } from "@/lib/comments/body";

const commentCreateSchema = z.object({
  body: z.string().min(1).max(8000)
});

export const GET = withApi({ scope: "tasks:read" }, async (_req, { params, api }) => {
  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  const items = await prisma.comment.findMany({
    where: { workspaceId: api.workspaceId, targetType: "TASK", targetId: params.id },
    include: { author: { select: { id: true, name: true, image: true } } },
    orderBy: { createdAt: "asc" }
  });

  // Lazy migration: si un comentario aún no tiene bodyJson, lo
  // calculamos al vuelo y lo persistimos en background. La UI lee
  // bodyJson directamente cuando exista; mantiene body como
  // fallback para compatibilidad.
  const enriched = items.map((c: any) => {
    const json = c.bodyJson ?? toTipTapDoc(c.body);
    if (!c.bodyJson) {
      // Persistencia fire-and-forget — no bloquea la respuesta.
      void prisma.comment
        .update({ where: { id: c.id }, data: { bodyJson: json as any } })
        .catch(() => {});
    }
    return { ...c, bodyJson: json };
  });

  return NextResponse.json({ items: enriched });
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Se requiere usuario autenticado para comentar");

  const body = await req.json().catch(() => null);
  const parsed = commentCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  // Persistimos en ambos campos: `body` (String NOT NULL legacy +
  // SQL LIKE search) y `bodyJson` (TipTap doc completo para la UI
  // rich y futuras búsquedas estructuradas).
  const doc = toTipTapDoc(parsed.data.body);
  const bodyString = serializeForString(parsed.data.body);

  const comment = await prisma.comment.create({
    data: {
      workspaceId: api.workspaceId,
      authorId: api.userId,
      targetType: "TASK",
      targetId: params.id,
      body: bodyString,
      bodyJson: doc as any
    },
    include: { author: { select: { id: true, name: true, image: true } } }
  });

  // Indexa el comentario para búsqueda semántica (texto plano del doc).
  void indexEntity({
    workspaceId: api.workspaceId,
    entityType: "COMMENT",
    entityId: comment.id,
    text: extractText(doc)
  }).catch(() => {});

  // Resolver @menciones. El body nuevo (TipTap JSON) trae los userIds
  // directos en nodos `mention.attrs.id`. El legacy texto plano sigue
  // resolviéndose por regex contra emails. Unimos ambos resultados y
  // deduplicamos.
  const directIds = extractMentionUserIds(parsed.data.body);
  const tokens = extractMentionTokens(parsed.data.body);

  // ── Hook Sonia: @nv-ia mention dispara un run ──────────────────
  // Si el comentario menciona a la user IA del workspace (por su
  // userId en un mention node, o por el handle "@nv-ia" en texto
  // plano) creamos un AiAgentRun en PENDING para que la procese.
  // Es una vía conversacional alternativa al "compartir con el
  // proyecto buzón" — más informal y sin salirte del thread.
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: api.workspaceId },
      select: { settings: true }
    });
    const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
    const plainBody = bodyString.toLowerCase();
    // Acepta @sonia (naming actual), @nv-ia / @nvia (legacy compat
     // para mantener funcionando los workspaces que ya tenían el nombre
     // antiguo cuando se acuñó el handle en sus procesos/docs).
    const mentionsAi =
      (aiUserId && directIds.includes(aiUserId)) ||
      /@sonia\b/i.test(plainBody) ||
      /@nv[\s-]?ia\b/i.test(plainBody);
    if (aiUserId && mentionsAi && api.userId !== aiUserId) {
      await prisma.aiAgentRun.create({
        data: {
          workspaceId: api.workspaceId,
          taskId: params.id,
          requesterId: api.userId,
          status: "PENDING"
        }
      });
    }
  } catch (e) {
    console.warn("[nv-ia] mention hook failed:", (e as Error).message);
  }

  if (directIds.length > 0 || tokens.length > 0) {
    const workspaceUsers = await prisma.user.findMany({
      where: { memberships: { some: { workspaceId: api.workspaceId } } },
      select: { id: true, email: true, name: true }
    });
    const byToken = resolveMentions(tokens, workspaceUsers);
    const byId = workspaceUsers.filter((u) => directIds.includes(u.id));
    const seen = new Set<string>();
    const mentioned = [...byId, ...byToken]
      .filter((u) => {
        if (u.id === api.userId) return false;
        if (seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      });
    if (mentioned.length > 0) {
      const taskInfo = await prisma.task.findUnique({
        where: { id: params.id },
        select: { title: true }
      });
      const notifBody = `${comment.author.name ?? "Alguien"} te mencionó en "${taskInfo?.title ?? "una tarea"}"`;
      const link = `/tareas?task=${params.id}`;
      await prisma.notification.createMany({
        data: mentioned.map((u) => ({
          userId: u.id,
          type: "mention",
          body: notifBody,
          link
        }))
      });
      // Web push paralelo — best-effort, no bloqueante
      await Promise.all(
        mentioned.map((u) =>
          sendPushToUser(u.id, {
            title: "Te han mencionado",
            body: notifBody,
            link,
            tag: `mention-${params.id}`
          }).catch((e) => console.warn("[push] mention fallo:", e?.message ?? e))
        )
      );
    }
  }

  return NextResponse.json(comment, { status: 201 });
});
