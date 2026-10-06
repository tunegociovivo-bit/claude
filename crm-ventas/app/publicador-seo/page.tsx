import AppShell from "@/components/AppShell";
import SeoBlogApp from "@/components/seo-blog/SeoBlogApp";
import { requireModulePage } from "@/lib/content/page-guard";

export const dynamic = "force-dynamic";

export default async function PublicadorSeoPage() {
  await requireModulePage("seo");
  return (
    <AppShell>
      <SeoBlogApp />
    </AppShell>
  );
}
