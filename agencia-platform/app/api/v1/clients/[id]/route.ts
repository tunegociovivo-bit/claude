import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { clientCreateSchema } from "@/lib/api/schemas";
import { callerIsAdmin, redactMrr } from "@/lib/api/permissions";
import { auditFromReq } from "@/lib/audit/log";
import { dispatchWebhook } from "@/lib/webhooks/dispatch";
import { indexEntity, deleteEntityIndex } from "@/lib/search/embeddings";
import { textForClient } from "@/lib/search/indexers";

export const GET = withApi({ scope: "clients:read" }, async (_req, { params, api }) => {
  const [client, isAdmin] = await Promise.all([
    prisma.client.findFirst({
      where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
      include: { projects: true }
    }),
    callerIsAdmin(api)
  ]);
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json(redactMrr(client as any, isAdmin));
});

export const PATCH = withApi({ scope: "clients:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = clientCreateSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const isAdmin = await callerIsAdmin(api);
  const data: any = { ...parsed.data };
  if (!isAdmin) delete data.mrr;

  // Snapshot anterior para el audit log si va a cambiar algo sensible.
  const previous = await prisma.client.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, name: true, mrr: true, status: true }
  });

  const updated = await prisma.client.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");
  const fresh = await prisma.client.findUnique({ where: { id: params.id } });

  if (previous && data.mrr !== undefined && previous.mrr !== data.mrr) {
    auditFromReq(req, api, {
      action: "client.mrr_change",
      targetType: "CLIENT",
      targetId: params.id,
      before: { mrr: previous.mrr },
      after: { mrr: data.mrr }
    });
    dispatchWebhook(api.workspaceId, "client.mrr_change", {
      id: params.id,
      previousMrr: previous.mrr,
      newMrr: data.mrr
    });
  } else if (Object.keys(data).length > 0) {
    auditFromReq(req, api, {
      action: "client.update",
      targetType: "CLIENT",
      targetId: params.id,
      meta: { fields: Object.keys(data) }
    });
    dispatchWebhook(api.workspaceId, "client.updated", {
      id: params.id,
      changedFields: Object.keys(data)
    });
  }

  // Re-indexa si tocaron campos indexables (name, industry, notes,
  // infoGeneral, brandBrief, website, contactName).
  const INDEXABLE = ["name", "industry", "notes", "infoGeneral", "brandBrief", "website", "contactName"];
  if (fresh && INDEXABLE.some((k) => k in data)) {
    void indexEntity({
      workspaceId: api.workspaceId,
      entityType: "CLIENT",
      entityId: params.id,
      text: textForClient(fresh as any)
    }).catch(() => {});
  }

  return NextResponse.json(redactMrr(fresh as any, isAdmin));
});

export const DELETE = withApi({ scope: "clients:write" }, async (req, { params, api }) => {
  const updated = await prisma.client.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    data: { deletedAt: new Date() }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");
  auditFromReq(req, api, {
    action: "client.delete",
    targetType: "CLIENT",
    targetId: params.id
  });
  void deleteEntityIndex("CLIENT", params.id).catch(() => {});
  return NextResponse.json({ ok: true });
});
