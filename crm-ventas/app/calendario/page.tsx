import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import CalendarioClient from "./CalendarioClient";

export const dynamic = "force-dynamic";

export default async function CalendarioPage() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.workspaceId) redirect("/login");
  return (
    <AppShell>
      <CalendarioClient />
    </AppShell>
  );
}
