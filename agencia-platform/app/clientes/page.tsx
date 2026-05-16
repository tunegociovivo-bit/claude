import PageHeader from "@/components/PageHeader";
import ClientesActions from "@/components/clientes/ClientesActions";
import ClientesListClient from "@/components/clientes/ClientesListClient";
import { getClientsForUi, getProjectsForUi, getTasksForUi } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const [clients, projects, tasks] = await Promise.all([
    getClientsForUi(),
    getProjectsForUi(),
    getTasksForUi()
  ]);

  const totalMrr = clients.reduce((s, c) => s + c.mrr, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Clientes"
        description="Base de datos interna de cuentas."
        actions={<ClientesActions />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500">Total cuentas</div>
          <div className="text-2xl font-semibold mt-1">{clients.length}</div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500">Activas</div>
          <div className="text-2xl font-semibold mt-1">
            {clients.filter((c) => c.status === "activo").length}
          </div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500">MRR total</div>
          <div className="text-2xl font-semibold mt-1">{totalMrr.toLocaleString("es-ES")} €</div>
        </div>
      </div>

      <ClientesListClient clients={clients} projects={projects} tasks={tasks} />
    </div>
  );
}
