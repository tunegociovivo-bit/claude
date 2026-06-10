import PageHeader from "@/components/PageHeader";
import ImporterClient from "@/components/admin/ImporterClient";

export const dynamic = "force-dynamic";

// Acceso gobernado por app/admin/layout.tsx.
export default function ImportPage() {
  return (
    <div className="max-w-5xl mx-auto pb-24">
      <PageHeader
        title="Importador (clientes y facturas)"
        description="Sube un listado en PDF, CSV o Excel. Si un cliente ya existe, solo se rellenan los datos que le falten — nunca se sobrescribe. Solo administradores."
      />
      <ImporterClient />
    </div>
  );
}
