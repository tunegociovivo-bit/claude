import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { deleteReference } from "@/lib/seo-blog/service";

export const dynamic = "force-dynamic";

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const ok = await deleteReference(api.workspaceId, params.id);
  if (!ok) throw new ApiError(404, "not_found", "No encontrado");
  return NextResponse.json({ ok: true });
});
