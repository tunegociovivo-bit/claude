/**
 * Panel admin de Bubui — protegido por la sesión NextAuth del Hub.
 *
 * Requiere usuario logueado en el Hub con rol ADMIN. Si no hay sesión o el
 * rol no es ADMIN, redirige al login del HUB (URL absoluta): el panel solo
 * funciona en el dominio del hub, porque la cookie de sesión no se comparte
 * con bubui.app (dominios distintos) y allí /login no existe. Mandar al login
 * del hub evita el "error de render" que salía al entrar por bubui.app/admin.
 *
 * Las APIs /api/bubui/admin/* también validan la sesión, así que esto es
 * defensa en profundidad (UX) sumada a la real (en el backend).
 */
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import BubuiAdminClient from "./BubuiAdminClient";

export const dynamic = "force-dynamic";

const HUB_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://hub.negociovivo.app").replace(/\/+$/, "");

export default async function BubuiAdminPage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session?.user) {
    redirect(`${HUB_URL}/login?callbackUrl=/bubui/admin`);
  }
  if (role !== "ADMIN") {
    redirect(`${HUB_URL}/login?callbackUrl=/bubui/admin&error=AccessDenied`);
  }
  return <BubuiAdminClient />;
}
