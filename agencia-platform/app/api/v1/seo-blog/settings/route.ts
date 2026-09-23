import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { requireWorkspaceAdmin } from "@/lib/seo-blog/access";
import { publicSeoBlogSettings, saveSeoBlogSettings } from "@/lib/seo-blog/settings";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireSeoBlogAccess(api);
  const me = api.userId ? await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId }, select: { role: true } }) : null;
  return NextResponse.json({ ...(await publicSeoBlogSettings(api.workspaceId)), isAdmin: !!api.apiKeyId || me?.role === "ADMIN" });
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  await requireSeoBlogAccess(api);
  await requireWorkspaceAdmin(api);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new ApiError(400, "validation_error", "JSON inválido");
  return NextResponse.json(await saveSeoBlogSettings(api.workspaceId, body));
});
