import { requireFeature } from "@/lib/auth-utils";
import TimeTrackingClient from "@/components/time-tracking/TimeTrackingClient";

export const dynamic = "force-dynamic";

export default async function ControlHorarioPage() {
  await requireFeature("equipo");
  return <TimeTrackingClient />;
}
