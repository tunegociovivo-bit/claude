import { redirect } from "next/navigation";
import { resolveSessionMember } from "@/lib/auth";
import { isModuleEnabled, type ContentModule } from "@/lib/modules";

/** Guard de servidor para las páginas de los módulos de contenidos. */
export async function requireModulePage(module: ContentModule): Promise<{ workspaceId: string; userId: string; role: string }> {
  const member = await resolveSessionMember();
  if (!member) redirect("/login");
  if (!(await isModuleEnabled(member.workspaceId, module))) redirect("/pipeline");
  return { workspaceId: member.workspaceId, userId: member.userId, role: member.role };
}
