import GmbReportClient from "@/components/gmb/GmbReportClient";
import { requireFeature } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export default async function GmbReportPage({ params }: { params: { id: string } }) {
  await requireFeature("gmb");
  return <GmbReportClient id={params.id} />;
}
