import AppShell from "@/components/AppShell";
import RadarClient from "@/components/radar/RadarClient";
import { requireModulePage } from "@/lib/content/page-guard";

export const dynamic = "force-dynamic";

export default async function RadarPage() {
  await requireModulePage("radar");
  return (
    <AppShell>
      <RadarClient />
    </AppShell>
  );
}
