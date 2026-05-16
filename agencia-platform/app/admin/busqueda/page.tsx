import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import BusquedaClient from "@/components/admin/BusquedaClient";

export const dynamic = "force-dynamic";

export default async function BusquedaPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  // Estado actual del índice: cuántos vectores hay por tipo.
  const grouped = await prisma.searchEmbedding.groupBy({
    by: ["entityType"],
    where: { workspaceId },
    _count: { _all: true }
  });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.entityType] = g._count._all;

  const [tasks, clients, projects, documents] = await Promise.all([
    prisma.task.count({ where: { workspaceId, deletedAt: null } as any }),
    prisma.client.count({ where: { workspaceId, deletedAt: null } }),
    prisma.project.count({ where: { workspaceId, deletedAt: null } as any }),
    prisma.document.count({ where: { workspaceId, archived: false, deletedAt: null } as any })
  ]);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Búsqueda semántica"
        description="Estado del índice de embeddings y backfill manual. Lo que esté aquí indexado se puede encontrar buscando por significado en el Cmd+K."
      />
      <BusquedaClient
        indexed={{
          TASK: counts.TASK ?? 0,
          CLIENT: counts.CLIENT ?? 0,
          PROJECT: counts.PROJECT ?? 0,
          DOCUMENT: counts.DOCUMENT ?? 0
        }}
        totals={{
          TASK: tasks,
          CLIENT: clients,
          PROJECT: projects,
          DOCUMENT: documents
        }}
      />
    </div>
  );
}
