import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ClientesActions from "@/components/clientes/ClientesActions";
import { getClientsForUi, getProjectsForUi, getTasksForUi } from "@/lib/db/queries";
import { Mail, Phone, Building2, ArrowUpRight } from "lucide-react";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  activo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pausa: "bg-amber-50 text-amber-800 border-amber-200",
  prospecto: "bg-sky-50 text-sky-700 border-sky-200"
};

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
        description="Base de datos interna de cuentas y prospectos."
        actions={<ClientesActions />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500">Total cuentas</div>
          <div className="text-2xl font-semibold mt-1">{clients.length}</div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500">Activas</div>
          <div className="text-2xl font-semibold mt-1">{clients.filter((c) => c.status === "activo").length}</div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500">MRR total</div>
          <div className="text-2xl font-semibold mt-1">{totalMrr.toLocaleString("es-ES")} €</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {clients.map((c) => {
          const clientProjects = projects.filter((p) => p.clientId === c.id);
          const clientTasks = tasks.filter((t) => t.clientId === c.id && t.status !== "done");
          return (
            <Link
              key={c.id}
              href={`/clientes/${c.id}`}
              className="bg-white rounded-xl border p-5 hover:shadow-sm hover:border-brand-200 transition group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-lg bg-slate-100 grid place-items-center text-slate-500">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold leading-tight">{c.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{c.industry}</p>
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600" />
              </div>

              <span className={`inline-block text-xs px-2 py-0.5 rounded-md border ${statusStyles[c.status]} mb-3`}>
                {c.status}
              </span>

              <div className="space-y-1.5 text-xs text-slate-600">
                <div className="flex items-center gap-2 truncate">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  {c.email}
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  {c.phone}
                </div>
              </div>

              <div className="border-t mt-4 pt-3 flex items-center justify-between text-xs">
                <div>
                  <div className="text-slate-500">Proyectos</div>
                  <div className="font-semibold">{clientProjects.length}</div>
                </div>
                <div>
                  <div className="text-slate-500">Tareas abiertas</div>
                  <div className="font-semibold">{clientTasks.length}</div>
                </div>
                <div>
                  <div className="text-slate-500">MRR</div>
                  <div className="font-semibold">{c.mrr ? `${c.mrr} €` : "—"}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
