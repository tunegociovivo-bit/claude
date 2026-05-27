import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import AuditLogTable from "@/components/admin/AuditLogTable";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage({
  searchParams
}: {
  searchParams: Promise<{ action?: string; entity?: string; actor?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  const sp = await searchParams;

  const where: any = { workspaceId };
  if (sp.action) where.action = sp.action;
  if (sp.entity) where.targetType = sp.entity;
  if (sp.actor) where.actorId = sp.actor;

  const [entries, total, actors] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200
    }),
    prisma.auditLog.count({ where }),
    prisma.membership.findMany({
      where: { workspaceId },
      select: { user: { select: { id: true, name: true, email: true } } }
    })
  ]);

  const actorMap = new Map(actors.map((a) => [a.user.id, a.user.name ?? a.user.email]));

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Auditoría"
        description={`Últimas 200 acciones registradas (${total} totales). Quién hizo qué, sobre qué y cuándo.`}
      />
      <AuditLogTable
        entries={entries.map((e) => ({
          id: e.id,
          createdAt: e.createdAt.toISOString(),
          actorId: e.actorId,
          actorName: e.actorId ? actorMap.get(e.actorId) ?? null : null,
          action: e.action,
          targetType: e.targetType,
          targetId: e.targetId,
          meta: e.meta as any
        }))}
        filterActor={sp.actor ?? ""}
        filterAction={sp.action ?? ""}
        filterEntity={sp.entity ?? ""}
        actors={Array.from(actorMap.entries()).map(([id, name]) => ({ id, name: name ?? "—" }))}
      />
    </div>
  );
}
