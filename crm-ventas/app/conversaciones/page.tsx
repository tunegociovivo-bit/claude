import { redirect } from "next/navigation";
import { resolveSessionMember } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import InboxPanel from "@/components/inbox/InboxPanel";
import { getWorkspaceSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Bandeja unificada de WhatsApp (todos los números del negocio). También
// disponible como pestaña dentro de /pipeline.
export default async function ConversacionesPage() {
  // Revalidado en BD (usuario aún miembro, workspace no bloqueado u operador).
  const member = await resolveSessionMember();
  if (!member) redirect("/login");
  const workspaceId = member.workspaceId;
  const settings = await getWorkspaceSettings(workspaceId);
  return (
    <AppShell>
      <InboxPanel columns={[...settings.pipeline.columns].sort((a, b) => a.order - b.order)} title="WhatsApp" />
    </AppShell>
  );
}
