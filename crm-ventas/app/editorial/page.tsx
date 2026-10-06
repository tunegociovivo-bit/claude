import AppShell from "@/components/AppShell";
import EditorialClient from "@/components/editorial/EditorialClient";
import { requireModulePage } from "@/lib/content/page-guard";

export const dynamic = "force-dynamic";

export default async function EditorialPage() {
  await requireModulePage("editorial");
  return (
    <AppShell>
      <EditorialClient />
    </AppShell>
  );
}
