import PageHeader from "@/components/PageHeader";
import AvatarStack from "@/components/AvatarStack";
import { getDashboardData } from "@/lib/db/queries";
import { isAdmin, requireFeature } from "@/lib/auth-utils";
import { statusLabels, statusColors, priorityColors } from "@/lib/mock-data";
import { ArrowUpRight, CheckCircle2, Clock, Users, Briefcase, TrendingUp } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireFeature("inicio");
  const { clients, tasks, projects, events, team } = await getDashboardData();
  const admin = await isAdmin();
  const today = new Date();

  const findClient = (id?: string) => clients.find((c) => c.id === id);
  const findProject = (id?: string) => projects.find((p) => p.id === id);

  const activeClients = clients.filter((c) => c.status === "activo").length;
  const openTasks = tasks.filter((t) => t.status !== "done").length;
  const doneThisMonth = tasks.filter((t) => t.status === "done").length;
  const mrr = clients.reduce((sum, c) => sum + c.mrr, 0);

  const upcoming = [...events]
    .filter((e) => new Date(e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const myTasks = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  const stats = [
    { label: "Clientes activos", value: activeClients, icon: Users, trend: `${clients.length} totales` },
    { label: "Tareas abiertas", value: openTasks, icon: Clock, trend: `${doneThisMonth} completadas` },
    { label: "Proyectos en curso", value: projects.length, icon: Briefcase, trend: "Todos al día" },
    ...(admin
      ? [{ label: "MRR estimado", value: `${mrr.toLocaleString("es-ES")} €`, icon: TrendingUp, trend: "+8% vs mes anterior" }]
      : [])
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Resumen"
        description={`Hoy es ${today.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}`}
      />

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${admin ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-4 mb-8`}>
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-xl border p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="h-9 w-9 rounded-lg bg-brand-50 text-brand-600 grid place-items-center">
                  <Icon className="h-4 w-4" />
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-300" />
              </div>
              <div className="text-2xl font-semibold">{s.value}</div>
              <div className="text-xs text-slate-500 mt-1">{s.label}</div>
              <div className="text-xs text-emerald-600 mt-2">{s.trend}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border">
          <div className="flex items-center justify-between p-5 border-b">
            <div>
              <h2 className="font-semibold">Tus próximas tareas</h2>
              <p className="text-xs text-slate-500 mt-0.5">Ordenadas por fecha de entrega</p>
            </div>
            <Link href="/tareas" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Ver todas →
            </Link>
          </div>
          <ul className="divide-y">
            {myTasks.map((t) => {
              const project = findProject(t.projectId);
              const client = findClient(t.clientId);
              return (
                <li key={t.id} className="p-5 flex items-center gap-4 hover:bg-slate-50">
                  <div className={`h-2 w-2 rounded-full ${project?.color ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${priorityColors[t.priority]}`}>
                        {t.priority}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                      <span>{client?.name}</span>
                      <span>·</span>
                      <span>{project?.name}</span>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-md border ${statusColors[t.status]}`}>
                    {statusLabels[t.status]}
                  </span>
                  <div className="text-xs text-slate-500 w-20 text-right">
                    {new Date(t.dueDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  </div>
                  <AvatarStack ids={t.assigneeIds} members={team} />
                </li>
              );
            })}
            {myTasks.length === 0 && (
              <li className="p-5 text-sm text-slate-500">No hay tareas pendientes.</li>
            )}
          </ul>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border">
            <div className="p-5 border-b flex items-center justify-between">
              <h2 className="font-semibold">Próximos eventos</h2>
              <Link href="/calendario" className="text-xs font-medium text-brand-600 hover:text-brand-700">
                Calendario →
              </Link>
            </div>
            <ul className="divide-y">
              {upcoming.map((e) => {
                const client = findClient(e.clientId);
                return (
                  <li key={e.id} className="p-4 flex items-start gap-3">
                    <div className="flex flex-col items-center justify-center bg-slate-50 rounded-md w-12 py-1">
                      <div className="text-[10px] uppercase text-slate-500">
                        {new Date(e.date).toLocaleDateString("es-ES", { month: "short" })}
                      </div>
                      <div className="text-base font-semibold">{new Date(e.date).getDate()}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{e.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {client?.name} {e.time && `· ${e.time}`}
                      </div>
                    </div>
                  </li>
                );
              })}
              {upcoming.length === 0 && (
                <li className="p-5 text-sm text-slate-500">No hay eventos próximos.</li>
              )}
            </ul>
          </div>

          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-4">Equipo</h2>
            <ul className="space-y-3">
              {team.map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  {m.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt={m.name} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className={`h-8 w-8 rounded-full ${m.color} text-white grid place-items-center text-xs font-semibold`}>
                      {m.initials}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{m.name}</div>
                    <div className="text-xs text-slate-500">{m.role}</div>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
