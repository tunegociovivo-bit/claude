import PageHeader from "@/components/PageHeader";
import GoogleSheetsSettingsClient from "@/components/admin/GoogleSheetsSettingsClient";

export const dynamic = "force-dynamic";

// El acceso lo gobierna app/admin/layout.tsx (ADMIN o miembro con la tarjeta
// /admin/integrations/google-sheets concedida).
export default function GoogleSheetsIntegrationPage() {
  return (
    <div className="max-w-2xl mx-auto pb-24">
      <PageHeader
        title="Google Sheets (gspread)"
        description="Pega el service_account.json para que Sonia pueda leer y escribir en hojas de cálculo de Google. Comparte cada hoja con el email del service account (Editor). Solo administradores."
      />
      <GoogleSheetsSettingsClient />
    </div>
  );
}
