/**
 * Panel admin de Bubui — ahora protegido por la sesión NextAuth del Hub.
 *
 * Requiere usuario logueado en el Hub con rol ADMIN. Si no hay sesión o
 * el rol no es ADMIN, redirige a /login con callback a esta página.
 *
 * Las APIs /api/bubui/admin/* también validan la sesión, así que esto
 * es defensa en profundidad (UX) sumada a la real (en el backend).
 */
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import BubuiAdminClient from "./BubuiAdminClient";

export const dynamic = "force-dynamic";

export default async function BubuiAdminPage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session?.user) {
    redirect("/login?callbackUrl=/bubui/admin");
  }
  if (role !== "ADMIN") {
    redirect("/login?callbackUrl=/bubui/admin&error=AccessDenied");
  }
  return <BubuiAdminClient />;
}
