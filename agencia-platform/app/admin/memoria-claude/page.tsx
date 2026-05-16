import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
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

export default async function MemoryPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

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
