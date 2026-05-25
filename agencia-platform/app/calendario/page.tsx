import { getEventsForUi, getClientsForUi, getTasksForUi } from "@/lib/db/queries";
import CalendarioClient from "@/components/calendario/CalendarioClient";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireFeature } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export default async function CalendarioPage() {
  await requireFeature("calendario");
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id ?? null;
  const [events, clients, tasks] = await Promise.all([
    getEventsForUi(userId),
    getClientsForUi(),
    getTasksForUi()
  ]);
  // Tareas del usuario actual con dueDate → se mostrarán como chips en
  // el calendario. Si la tarea no es de este usuario o no tiene fecha,
  // no aparece. Para ver tareas de otros, abrir /tareas.
  const myTasks = userId
    ? tasks.filter((t) => t.assigneeIds?.includes(userId) && !!t.dueDate)
    : [];
  return <CalendarioClient events={events} clients={clients} myTasks={myTasks} />;
}
