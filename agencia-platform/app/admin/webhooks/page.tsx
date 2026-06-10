import PageHeader from "@/components/PageHeader";
import WebhooksClient from "@/components/admin/WebhooksClient";

export const dynamic = "force-dynamic";

// Acceso gobernado por app/admin/layout.tsx.
export default function WebhooksPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Webhooks salientes"
        description="Recibe en una URL un POST cuando algo cambia en el workspace. Conecta con Make, Zapier, n8n o un endpoint propio."
      />
      <WebhooksClient />
    </div>
  );
}
