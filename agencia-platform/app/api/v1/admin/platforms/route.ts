import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { PLATFORMS, type PlatformsSettings } from "@/lib/platforms";

const updateSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean().optional(),
  memberIds: z.array(z.string()).optional(),
  restricted: z.boolean().optional(),
  customLabel: z.string().max(60).nullable().optional(),
  customDescription: z.string().max(300).nullable().optional()
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
  if (!PLATFORMS.some((platform) => platform.key === parsed.data.key)) {
    throw new ApiError(400, "unknown_platform", "Plataforma no válida");
  }
  if (parsed.data.memberIds) {
    const validMembers = await prisma.membership.findMany({
      where: { workspaceId: api.workspaceId, userId: { in: parsed.data.memberIds } },
      select: { userId: true }
    });
    if (validMembers.length !== new Set(parsed.data.memberIds).size) {
      throw new ApiError(400, "invalid_platform_members", "Hay usuarios que no pertenecen al workspace");
    }
  }

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.platforms ??= {};
  const current = settings.platforms[parsed.data.key] ?? { enabled: false, memberIds: [] };
  if (parsed.data.enabled !== undefined) current.enabled = parsed.data.enabled;
  if (parsed.data.memberIds !== undefined) current.memberIds = parsed.data.memberIds;
  if (parsed.data.restricted !== undefined) current.restricted = parsed.data.restricted;
  if (parsed.data.customLabel !== undefined) {
    if (parsed.data.customLabel === null || parsed.data.customLabel.trim() === "") {
      delete current.customLabel;
    } else {
      current.customLabel = parsed.data.customLabel.trim();
    }
  }
  if (parsed.data.customDescription !== undefined) {
    if (parsed.data.customDescription === null || parsed.data.customDescription.trim() === "") {
      delete current.customDescription;
    } else {
      current.customDescription = parsed.data.customDescription.trim();
    }
  }
  settings.platforms[parsed.data.key] = current;

  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });

  return NextResponse.json({ ok: true, config: settings.platforms });
});
