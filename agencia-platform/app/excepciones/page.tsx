import PageHeader from "@/components/PageHeader";
import ExceptionsInbox from "@/components/exceptions/ExceptionsInbox";

export const dynamic = "force-dynamic";

export default function ExcepcionesPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Excepciones"
        description="Incidencias que requieren tu intervención: aprobaciones, automatizaciones fallidas, SLA, cobros, mensajes y tareas bloqueadas."
      />
      <ExceptionsInbox />
    </div>
  );
}
