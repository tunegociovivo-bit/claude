import { getEventsForUi, getClientsForUi } from "@/lib/db/queries";
import CalendarioClient from "@/components/calendario/CalendarioClient";

export const dynamic = "force-dynamic";

export default async function CalendarioPage() {
  const [events, clients] = await Promise.all([getEventsForUi(), getClientsForUi()]);
  return <CalendarioClient events={events} clients={clients} />;
}
