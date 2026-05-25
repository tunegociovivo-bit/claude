import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import UsuariosClient from "@/components/admin/UsuariosClient";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  // Solo admins del workspace pueden gestionar usuarios y permisos. El resto
  // rebota a la home (mismo patrón que el resto de páginas de /admin).
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");
  return <UsuariosClient />;
}
