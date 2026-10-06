import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { deleteReference } from "@/lib/seo-blog/service";

export const dynamic = "force-dynamic";

export const DELETE = withApi({ module: "seo" }, async (_req, { params, api }) => {
  const ok = await deleteReference(api.workspaceId, String(params.id ?? ""));
  if (!ok) throw new ApiError(404, "not_found", "No encontrado");
  return NextResponse.json({ ok: true });
});
