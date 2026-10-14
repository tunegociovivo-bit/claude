import { redirect } from "next/navigation";
import { resolveSessionMember } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import CalendarioClient from "./CalendarioClient";

export const dynamic = "force-dynamic";

export default async function CalendarioPage() {
  if (!(await resolveSessionMember())) redirect("/login");
  return (
    <AppShell>
      <CalendarioClient />
    </AppShell>
  );
}
