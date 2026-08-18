/**
 * Edición y flujo de un borrador de publicación GBP.
 *  PATCH { fields } → edita el borrador (valida). PATCH { command } → transición de estado
 *    (submit/approve/reject/schedule/unschedule/fail/revert). La publicación externa es adapter-gated
 *    y nunca automática sin aprobación. DELETE elimina el borrador. Tenant-scoped + auditoría.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { computePostTransition, validateDraft, type PostStatus, type PostCommand } from "@/lib/gmb/content-workflow";
import { logGmbActivity } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

const schema = z.object({
  command: z.enum(["submit", "approve", "reject", "schedule", "unschedule", "fail", "revert"]).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  postType: z.string().optional(),
  cta: z.string().optional(),
  imageUrl: z.string().optional(),
  scheduledAt: z.string().nullable().optional()
});

async function loadPost(workspaceId: string, clientId: string, postId: string) {
  return prisma.gmbPost.findFirst({ where: { id: postId, workspaceId, clientId } });
}

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const post = await loadPost(api.workspaceId, client.id, (params as any).postId);
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Transición de estado.
  if (parsed.data.command) {
    const t = computePostTransition(post.status as PostStatus, parsed.data.command as PostCommand, { actorId: api.userId, scheduledAt: post.scheduledAt });
    if (!t.ok) throw new ApiError(409, "invalid_transition", t.error ?? "Transición inválida");
    const data: any = { status: t.next };
    if (parsed.data.command === "approve") { data.approvedById = api.userId ?? null; data.approvedAt = new Date(); }
    await prisma.gmbPost.updateMany({ where: { id: post.id, workspaceId: api.workspaceId }, data });
    await logGmbActivity({ workspaceId: api.workspaceId, clientId: client.id, actionType: `post_${parsed.data.command}`, description: `Publicación «${post.title || post.id}» → ${t.next}` }).catch(() => {});
    return NextResponse.json({ ok: true, id: post.id, status: t.next });
  }

  // Edición del borrador (solo en estados editables).
  if (!["draft", "pending_approval"].includes(post.status)) throw new ApiError(409, "not_editable", "Solo se editan borradores o pendientes de aprobación");
  const v = validateDraft({ title: parsed.data.title ?? post.title, content: parsed.data.content ?? post.content, postType: parsed.data.postType ?? post.postType, cta: parsed.data.cta ?? post.cta, imageUrl: parsed.data.imageUrl ?? post.imageUrl, scheduledAt: parsed.data.scheduledAt ?? (post.scheduledAt ? post.scheduledAt.toISOString() : null) }, new Date());
  if (!v.ok) throw new ApiError(400, "validation_error", v.errors.join(" "));
  await prisma.gmbPost.updateMany({ where: { id: post.id, workspaceId: api.workspaceId }, data: { title: v.normalized.title, content: v.normalized.content, postType: v.normalized.postType, cta: v.normalized.cta, imageUrl: v.normalized.imageUrl, scheduledAt: v.normalized.scheduledAt ? new Date(v.normalized.scheduledAt) : null } });
  return NextResponse.json({ ok: true, id: post.id, normalized: v.normalized });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const post = await loadPost(api.workspaceId, client.id, (params as any).postId);
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  await prisma.gmbPost.deleteMany({ where: { id: post.id, workspaceId: api.workspaceId } });
  return NextResponse.json({ ok: true });
});
