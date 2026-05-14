import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import AvatarStack from "@/components/AvatarStack";
import ClienteDetailActions from "@/components/clientes/ClienteDetailActions";
import {
  getClientsForUi,
  getProjectsForUi,
  getTasksForUi,
  getEventsForUi,
  getTeamForUi
} from "@/lib/db/queries";
import { statusLabels, statusColors } from "@/lib/mock-data";
import { Building2, Mail, Phone, Calendar, ArrowLeft, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClienteDetailPage({ params }: { params: { id: string } }) {
  const [clients, projects, tasks, events, team] = await Promise.all([
    getClientsForUi(),
    getProjectsForUi(),
    getTasksForUi(),
    getEventsForUi(),
    getTeamForUi()
  ]);

  const client = clients.find((c) => c.id === params.id);
  if (!client) notFound();

  const clientProjects = projects.filter((p) => p.clientId === client.id);
  const clientTasks = tasks.filter((t) => t.clientId === client.id);
  const clientEvents = events.filter((e) => e.clientId === client.id);
  const findProject = (id: string) => projects.find((p) => p.id === id);

  return (
    <div className="max-w-6xl mx-auto">
      <Link href="/clientes" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver a clientes
      </Link>

      <PageHeader
        title={client.name}
        description={`${client.industry} · Cliente desde ${new Date(client.since).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}`}
        actions={
          <ClienteDetailActions
            client={{
              id: client.id,
              name: client.name,
              industry: client.industry,
              status: client.status === "activo" ? "ACTIVE" : client.status === "pausa" ? "PAUSED" : "PROSPECT",
              contactName: client.contactName,
              email: client.email,
              phone: client.phone,
              mrr: client.mrr,
              notes: client.notes
            }}
          />
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border p-6">
            <h2 className="font-semibold mb-4">Proyectos</h2>
            <div className="space-y-3">
              {clientProjects.map((p) => (
                <div key={p.id} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-slate-50">
                  <span className={`h-3 w-3 rounded-full ${p.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-slate-500 line-clamp-1">{p.description}</div>
                  </div>
                  <div className="w-32">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">Progreso</span>
                      <span className="font-medium">{p.progress}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div className={`h-full ${p.color} rounded-full`} style={{ width: `${p.progress}%` }} />
                    </div>
                  </div>
                </div>
              ))}
              {clientProjects.length === 0 && (
                <p className="text-sm text-slate-500">Aún no hay proyectos asociados.</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6">
            <h2 className="font-semibold mb-4">Tareas relacionadas</h2>
            <ul className="divide-y -mx-6 px-6">
              {clientTasks.map((t) => {
                const project = findProject(t.projectId);
                return (
                  <li key={t.id} className="py-3 flex items-center gap-4">
                    <span className={`h-2 w-2 rounded-full ${project?.color ?? "bg-slate-300"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{t.title}</div>
                      <div className="text-xs text-slate-500">{project?.name}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-md border ${statusColors[t.status]}`}>
                      {statusLabels[t.status]}
                    </span>
                    <AvatarStack ids={t.assigneeIds} size={6} members={team} />
                  </li>
                );
              })}
              {clientTasks.length === 0 && <li className="py-3 text-sm text-slate-500">Sin tareas.</li>}
            </ul>
          </div>

          <div className="bg-white rounded-xl border p-6">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400" />
              Notas internas
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">{client.notes}</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-6">
            <h2 className="font-semibold mb-4">Información de contacto</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <Building2 className="h-4 w-4 text-slate-400 mt-0.5" />
                <div>
                  <div className="text-xs text-slate-500">Persona</div>
                  <div>{client.contactName}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="h-4 w-4 text-slate-400 mt-0.5" />
                <div>
                  <div className="text-xs text-slate-500">Email</div>
                  <div>{client.email}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="h-4 w-4 text-slate-400 mt-0.5" />
                <div>
                  <div className="text-xs text-slate-500">Teléfono</div>
                  <div>{client.phone}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-400" />
              Próximos eventos
            </h2>
            <ul className="space-y-3">
              {clientEvents.map((e) => (
                <li key={e.id} className="text-sm">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(e.date).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" })}
                    {e.time && ` · ${e.time}`}
                  </div>
                </li>
              ))}
              {clientEvents.length === 0 && <li className="text-sm text-slate-500">Sin eventos planificados.</li>}
            </ul>
          </div>

          <div className="bg-gradient-to-br from-brand-50 to-brand-100/50 rounded-xl border border-brand-200 p-6">
            <div className="text-xs text-brand-700 font-medium uppercase tracking-wide">Facturación</div>
            <div className="text-3xl font-semibold mt-1">{client.mrr.toLocaleString("es-ES")} €</div>
            <div className="text-xs text-slate-600 mt-1">MRR estimado</div>
          </div>
        </div>
      </div>
    </div>
  );
}
