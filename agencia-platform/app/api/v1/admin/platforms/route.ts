import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { PLATFORMS, type PlatformsSettings } from "@/lib/platforms";

const updateSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean().optional(),
  memberIds: z.array(z.string()).optional()
});

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings = (ws?.settings as any) ?? {};
  const cfg: PlatformsSettings = settings.platforms ?? {};

  return NextResponse.json({
    catalog: PLATFORMS,
    config: cfg
  });
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.platforms ??= {};
  const current = settings.platforms[parsed.data.key] ?? { enabled: false, memberIds: [] };
  if (parsed.data.enabled !== undefined) current.enabled = parsed.data.enabled;
  if (parsed.data.memberIds !== undefined) current.memberIds = parsed.data.memberIds;
  settings.platforms[parsed.data.key] = current;

  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });

  return NextResponse.json({ ok: true, config: settings.platforms });
});
