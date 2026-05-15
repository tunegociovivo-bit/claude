/**
 * Devuelve las plataformas visibles para el usuario actual. Usado por
 * el sidebar para pintar la sección "Plataformas".
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { platformsVisibleTo } from "@/lib/platforms";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings = (ws?.settings as any) ?? {};

  let isAdmin = false;
  if (api.userId) {
    const me = await prisma.membership.findFirst({
      where: { userId: api.userId, workspaceId: api.workspaceId }
    });
    isAdmin = me?.role === "ADMIN";
  }

  const items = platformsVisibleTo(settings, api.userId ?? "", isAdmin).map((p) => ({
    key: p.key,
    label: p.label,
    href: p.href,
    iconName: p.icon.displayName ?? null
  }));

  return NextResponse.json({ items });
});
