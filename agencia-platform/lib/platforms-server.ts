import { prisma } from "@/lib/db/prisma";
import { platformsVisibleTo, type PlatformKey } from "@/lib/platforms";

export async function userCanAccessPlatform(
  workspaceId: string,
  userId: string,
  platformKey: PlatformKey
): Promise<boolean> {
  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } }),
    prisma.membership.findFirst({ where: { workspaceId, userId }, select: { role: true } })
  ]);
  if (!workspace || !membership) return false;
  return platformsVisibleTo(workspace.settings, userId, membership.role === "ADMIN")
    .some((platform) => platform.key === platformKey);
}
