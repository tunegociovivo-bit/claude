import { getTasksForUi, getProjectsForUi, getClientsForUi, getTeamForUi } from "@/lib/db/queries";
import { requireFeature } from "@/lib/auth-utils";
import TareasClient from "./TareasClient";

export const dynamic = "force-dynamic";

export default async function TareasPage() {
  await requireFeature("tareas");
  const [tasks, projects, clients, team] = await Promise.all([
    getTasksForUi(),
    getProjectsForUi(),
    getClientsForUi(),
    getTeamForUi()
  ]);
  return <TareasClient tasks={tasks} projects={projects} clients={clients} team={team} />;
}
