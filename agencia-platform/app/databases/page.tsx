import { requireFeature } from "@/lib/auth-utils";
import DatabasesClient from "./DatabasesClient";

export const dynamic = "force-dynamic";

export default async function DatabasesPage() {
  await requireFeature("databases");
  return <DatabasesClient />;
}
