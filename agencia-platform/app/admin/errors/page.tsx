import ErrorsClient from "@/components/admin/ErrorsClient";

export const dynamic = "force-dynamic";

// Acceso gobernado por app/admin/layout.tsx.
export default function AdminErrorsPage() {
  return <ErrorsClient />;
}
