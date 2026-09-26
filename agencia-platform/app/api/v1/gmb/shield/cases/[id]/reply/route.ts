/**
 * POST /api/v1/gmb/shield/cases/[id]/reply → genera la respuesta pública sugerida (IA)
 * PUT  /api/v1/gmb/shield/cases/[id]/reply → guarda el texto y, con publish:true, la publica en Google
 *      (sólo fichas propias conectadas; es una acción explícita del usuario).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { publishReply, replyDraft } from "@/lib/gmb/fake-reviews/cases";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "*", rate: "ai" }, async (_req, { params, api }) => {
  const c = await prisma.gmbReviewCase.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!c) throw new ApiError(404, "not_found", "Caso no encontrado");
  if (c.target !== "cliente") throw new ApiError(400, "validation_error", "Sólo se responde a reseñas de la ficha del cliente.");
  const text = await replyDraft(api.workspaceId, api.userId ?? null, c);
  await prisma.gmbReviewCase.updateMany({ where: { id: c.id, workspaceId: api.workspaceId }, data: { replyDraft: text } });
  return NextResponse.json({ text });
});

const put = z.object({ text: z.string().min(5).max(4000), publish: z.boolean().default(false) });

export const PUT = withApi({ scope: "*" }, async (req, { params, api }) => {
  const p = put.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "validation_error", p.error.issues[0]?.message ?? p.error.message);
  const c = await prisma.gmbReviewCase.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!c) throw new ApiError(404, "not_found", "Caso no encontrado");
  await prisma.gmbReviewCase.updateMany({ where: { id: c.id, workspaceId: api.workspaceId }, data: { replyDraft: p.data.text } });
  if (!p.data.publish) return NextResponse.json({ ok: true, published: false });
  const r = await publishReply(api.workspaceId, c, p.data.text);
  if (!r.ok) throw new ApiError(409, "not_published", r.error);
  await prisma.gmbReviewCase.updateMany({ where: { id: c.id, workspaceId: api.workspaceId }, data: { replyPublishedAt: new Date() } });
  return NextResponse.json({ ok: true, published: true });
});
