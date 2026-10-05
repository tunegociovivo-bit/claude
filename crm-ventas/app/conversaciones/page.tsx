import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import InboxPanel from "@/components/inbox/InboxPanel";
import { getWorkspaceSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Bandeja unificada de WhatsApp (todos los números del negocio). También
// disponible como pestaña dentro de /pipeline.
export default async function ConversacionesPage() {
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  if (!workspaceId) redirect("/login");
  const settings = await getWorkspaceSettings(workspaceId);
  return (
    <AppShell>
      <InboxPanel columns={[...settings.pipeline.columns].sort((a, b) => a.order - b.order)} title="WhatsApp" />
    </AppShell>
  );
}
