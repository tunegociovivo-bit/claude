import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import PersonalizarClient from "@/components/admin/PersonalizarClient";

export const dynamic = "force-dynamic";

export default async function PersonalizarPage() {
  // Personalización del menú: preferencia personal de cada usuario, así que
  // basta con que haya sesión (NO se exige rol ADMIN, a diferencia del resto
  // de /admin). El middleware ya redirige a /login si no hay sesión.
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) redirect("/login");
  return <PersonalizarClient />;
}
