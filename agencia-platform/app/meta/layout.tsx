import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { userCanAccessPlatform } from "@/lib/platforms-server";

export default async function MetaLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  if (!(await userCanAccessPlatform(workspaceId, userId, "meta_suite"))) redirect("/");
  return <>{children}</>;
}
