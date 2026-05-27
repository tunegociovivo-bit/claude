import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

type TreeNode = { id: string; title: string; icon: string | null; children: TreeNode[] };

export const GET = withApi({ scope: "docs:read" }, async (_req, { api }) => {
  const docs = await prisma.document.findMany({
    where: { workspaceId: api.workspaceId, archived: false },
    select: { id: true, title: true, icon: true, parentId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" }
  });

  const byParent = new Map<string | null, typeof docs>();
  for (const d of docs) {
    const key = d.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(d);
  }

  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      icon: d.icon,
      children: build(d.id)
    }));

  return NextResponse.json({ tree: build(null) });
});
