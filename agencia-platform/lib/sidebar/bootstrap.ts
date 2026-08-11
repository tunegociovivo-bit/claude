/**
 * Compositor del arranque del Sidebar (FASE 2 · objetivo 5).
 *
 * Reúne en UNA sola respuesta lo que hoy el Sidebar pide en 6 fetch no-store
 * (projects, clients, me, platforms, workspace, sidebar-usage). Reutiliza los
 * mismos helpers compartidos (effectiveFeatures, platformsVisibleTo) y replica
 * las MISMAS queries/filtros que los endpoints individuales para no divergir.
 * Los endpoints originales se mantienen intactos (el Sidebar cae a ellos si este
 * agregado fallara).
 */
import { prisma } from "@/lib/db/prisma";
import { effectiveFeatures } from "@/lib/features";
import { platformsVisibleTo } from "@/lib/platforms";
import { redactMrrList } from "@/lib/api/permissions";

// Espejo de app/api/v1/sidebar-usage/route.ts (mapa pequeño y estable).
const FEATURE_TO_PLATFORM: Record<string, string> = {
  reviews_generate: "reviews",
  voice_transcribe: "voice_reviews",
  voice_draft: "voice_reviews",
  editorial_generate_month: "nv_dashboard",
  leads_opener: "nv_leads",
  redactor: "redactor_ia"
};

export async function getSidebarBootstrap(workspaceId: string, userId: string | null) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings = (ws?.settings as any) ?? {};

  // Membership (rol) una sola vez, reutilizado por me / platforms / projects.
  const membership = userId
    ? await prisma.membership.findFirst({ where: { workspaceId, userId } })
    : null;
  const role = (membership?.role as "ADMIN" | "MEMBER" | "GUEST" | undefined) ?? null;
  const isAdmin = role === "ADMIN";

  // ── me ──
  // Solo lo que consume el Sidebar (name/email/image); no enviamos phone/2FA.
  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, image: true }
      })
    : null;
  const features = role ? effectiveFeatures(role, (membership as any)?.features ?? null) : [];

  // ── platforms ── (mismo helper que la ruta)
  const platforms = platformsVisibleTo(settings, userId ?? "", isAdmin).map((p) => ({
    key: p.key,
    label: p.effectiveLabel,
    href: p.href,
    iconName: p.icon.displayName ?? null
  }));

  // ── projects ── (replica el filtro de permisos del endpoint)
  const projWhere: any = { workspaceId, archived: false, deletedAt: null };
  if (userId && membership && membership.role !== "ADMIN") {
    projWhere.OR = [{ members: { some: { userId } } }, { members: { none: {} } }];
  }
  const projects = await prisma.project.findMany({
    where: projWhere,
    include: {
      client: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true, image: true } },
      _count: { select: { tasks: true, members: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  // ── clients ── (paridad con /api/v1/clients: mismo cap 500 y MISMA redacción
  // de mrr para no-admin; sin esto el agregado filtraría ingresos a MEMBER/GUEST).
  const clientRows = await prisma.client.findMany({
    where: { workspaceId, deletedAt: null } as any,
    take: 500,
    orderBy: { createdAt: "desc" }
  });
  const clients = redactMrrList(clientRows as any, isAdmin);

  // ── usage (7 días) ──
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.aiUsage.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    select: { projectId: true, costMicros: true, feature: true }
  });
  const byProject = new Map<string, number>();
  const byPlatform = new Map<string, number>();
  for (const r of rows) {
    if (r.projectId) byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + r.costMicros);
    const pk = FEATURE_TO_PLATFORM[r.feature];
    if (pk) byPlatform.set(pk, (byPlatform.get(pk) ?? 0) + r.costMicros);
  }
  const usageProjects = Array.from(byProject.entries()).map(([id, micros]) => ({ id, micros }));
  const usagePlatforms = Array.from(byPlatform.entries()).map(([key, micros]) => ({ key, micros }));
  const maxMicros = Math.max(0, ...usageProjects.map((p) => p.micros), ...usagePlatforms.map((p) => p.micros));

  return {
    workspace: ws ? { id: ws.id, name: ws.name, slug: ws.slug, logo: ws.logo } : null,
    me: { user, role, features },
    platforms: { items: platforms },
    projects: { items: projects },
    clients: { items: clients },
    usage: { weekStart: since.toISOString(), projects: usageProjects, platforms: usagePlatforms, maxMicros }
  };
}
