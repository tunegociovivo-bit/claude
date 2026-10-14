import { redirect } from "next/navigation";
import { resolveSessionMember } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import AjustesClient from "./AjustesClient";

export const dynamic = "force-dynamic";

export default async function AjustesPage() {
  if (!(await resolveSessionMember())) redirect("/login");
  return (
    <AppShell>
      <AjustesClient />
    </AppShell>
  );
}
