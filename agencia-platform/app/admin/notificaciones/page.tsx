import PageHeader from "@/components/PageHeader";
import { Bell } from "lucide-react";

export default function NotificacionesPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Notificaciones" description="Bandeja de notificaciones del workspace." />
      <div className="bg-white rounded-xl border p-10 text-center">
        <div className="h-12 w-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3 text-slate-400">
          <Bell className="h-5 w-5" />
        </div>
        <p className="text-sm text-slate-600">Aún no tienes notificaciones.</p>
        <p className="text-xs text-slate-400 mt-1">
          Las notificaciones de @menciones, asignaciones de tareas y recordatorios de fecha de entrega aparecerán aquí en el próximo PR.
        </p>
      </div>
    </div>
  );
}
