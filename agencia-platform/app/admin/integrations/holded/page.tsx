import PageHeader from "@/components/PageHeader";
import HoldedSettingsClient from "@/components/admin/HoldedSettingsClient";

export const dynamic = "force-dynamic";

// El acceso lo gobierna app/admin/layout.tsx (ADMIN o miembro con la tarjeta
// /admin/integrations/holded concedida).
export default function HoldedIntegrationPage() {
  return (
    <div className="max-w-2xl mx-auto pb-24">
      <PageHeader
        title="Holded (contabilidad)"
        description="Conecta tu cuenta de Holded con su API key para descargar y gestionar facturas y contactos. Solo administradores."
      />
      <HoldedSettingsClient />
    </div>
  );
}
