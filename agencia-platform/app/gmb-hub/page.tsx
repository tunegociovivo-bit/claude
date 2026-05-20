import GmbHubClient from "@/components/gmb/GmbHubClient";
import { requireFeature } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export default async function GmbHubPage() {
  await requireFeature("gmb");
  return <GmbHubClient />;
}
