import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import AjustesClient from "./AjustesClient";

export const dynamic = "force-dynamic";

export default async function AjustesPage() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.workspaceId) redirect("/login");
  return (
    <AppShell>
      <AjustesClient />
    </AppShell>
  );
}
