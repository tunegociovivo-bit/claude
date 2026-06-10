import { redirect } from "next/navigation";
import { getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import BusquedaClient from "@/components/admin/BusquedaClient";

export const dynamic = "force-dynamic";

// Acceso gobernado por app/admin/layout.tsx.
export default async function BusquedaPage() {
  const workspaceId = await getSessionWorkspaceId();
  if (!workspaceId) redirect("/login");

  // Estado actual del índice: cuántos vectores hay por tipo.
  const grouped = await prisma.searchEmbedding.groupBy({
    by: ["entityType"],
    where: { workspaceId },
    _count: { _all: true }
  });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.entityType] = g._count._all;

  const [tasks, clients, projects, documents, comments] = await Promise.all([
    prisma.task.count({ where: { workspaceId, deletedAt: null } as any }),
    prisma.client.count({ where: { workspaceId, deletedAt: null } }),
    prisma.project.count({ where: { workspaceId, deletedAt: null } as any }),
    prisma.document.count({ where: { workspaceId, archived: false, deletedAt: null } as any }),
    prisma.comment.count({ where: { workspaceId } })
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
          DOCUMENT: counts.DOCUMENT ?? 0,
          COMMENT: counts.COMMENT ?? 0
        }}
        totals={{
          TASK: tasks,
          CLIENT: clients,
          PROJECT: projects,
          DOCUMENT: documents,
          COMMENT: comments
        }}
      />
    </div>
  );
}
