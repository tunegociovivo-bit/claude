import { requireFeature } from "@/lib/auth-utils";
import DocumentosClient from "./DocumentosClient";

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  await requireFeature("documentos");
  return <DocumentosClient />;
}
