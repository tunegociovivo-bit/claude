import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import BubuiAdminClient from "./BubuiAdminClient";

export const dynamic = "force-dynamic";

export default async function BubuiAdminPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  if (userId) {
    const workspaceId = await getSessionWorkspaceId();
    if (workspaceId) {
      const membership = await prisma.membership.findFirst({ where: { userId, workspaceId } });
      if (membership && membership.role !== "ADMIN") {
        redirect("/");
      }
    }
  }

  return <BubuiAdminClient />;
}
