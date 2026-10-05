import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled, type ContentModule } from "@/lib/modules";

/** Guard de servidor para las páginas de los módulos de contenidos. */
export async function requireModulePage(module: ContentModule): Promise<{ workspaceId: string; userId: string; role: string }> {
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  const userId = (session?.user as any)?.id as string | undefined;
  if (!workspaceId || !userId) redirect("/login");
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, workspace: { isBlocked: false } },
    select: { role: true },
  });
  if (!user) redirect("/login");
  if (!(await isModuleEnabled(workspaceId, module))) redirect("/pipeline");
  return { workspaceId, userId, role: user.role };
}
