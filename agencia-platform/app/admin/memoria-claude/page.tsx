import { redirect } from "next/navigation";
import { getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import MemoryClient from "@/components/admin/MemoryClient";
import {
  ARCHITECTURE_NOTES,
  GOTCHAS,
  PENDIENTES,
  PROJECT_OVERVIEW,
  SPRINTS
} from "@/lib/claude-memory/contents";

export const dynamic = "force-dynamic";

// Acceso gobernado por app/admin/layout.tsx.
export default async function MemoryPage() {
  const workspaceId = await getSessionWorkspaceId();
  if (!workspaceId) redirect("/login");

  // Notas custom guardadas en workspace.settings.claudeMemory
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  const initialNotes = settings?.claudeMemory?.notes ?? [];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Memoria del proyecto"
        description="Documento maestro para Claude (y para ti). Si abres una sesión nueva y Claude no recuerda algo, mándalo aquí."
      />
      <MemoryClient
        overview={PROJECT_OVERVIEW}
        architecture={ARCHITECTURE_NOTES}
        gotchas={GOTCHAS}
        pendientes={PENDIENTES}
        sprints={SPRINTS as any}
        initialNotes={initialNotes}
      />
    </div>
  );
}
