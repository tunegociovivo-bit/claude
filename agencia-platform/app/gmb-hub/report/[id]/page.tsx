import GmbReportClient from "@/components/gmb/GmbReportClient";
import { requireFeature } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export default async function GmbReportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireFeature("gmb");
  return <GmbReportClient id={params.id} />;
}
