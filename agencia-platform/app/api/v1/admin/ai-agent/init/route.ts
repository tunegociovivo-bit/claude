/**
 * POST /api/v1/admin/ai-agent/init
 *
 * Bootstrap de NV IA en el workspace actual. Idempotente — se puede
 * llamar tantas veces como haga falta; si ya existe, devuelve el
 * estado actual sin tocar nada.
 *
 * Crea:
 *  1. User "NV IA" (un User real del sistema, sin contraseña — no
 *     puede hacer login). Su Membership en el workspace es MEMBER.
 *  2. Proyecto "🤖 NV IA — Tareas IA" (el "buzón"). Cuando alguien
 *     enlaza una tarea suya a este proyecto vía TaskProject, se
 *     dispara un AiAgentRun en PENDING.
 *  3. ProjectMember del user NV IA en ese proyecto.
 *  4. Guarda { userId, inboxProjectId, model, maxStepsPerRun,
 *     maxTokensPerRun } en Workspace.settings.aiAgent.
 *
 * Sólo admin.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { DEFAULT_AGENT_CONFIG } from "@/lib/ai/nv-ia/types";

const AI_USER_EMAIL = "nv-ia@negociovivo.app";
const AI_USER_NAME = "NV IA";
const AI_PROJECT_NAME = "🤖 NV IA — Tareas IA";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) {
    throw new ApiError(403, "forbidden", "Solo admin del workspace puede inicializar NV IA");
  }

  // 1. User NV IA
  let aiUser = await prisma.user.findUnique({ where: { email: AI_USER_EMAIL } });
  if (!aiUser) {
    aiUser = await prisma.user.create({
      data: {
        email: AI_USER_EMAIL,
        name: AI_USER_NAME,
        // passwordHash null → no puede hacer login. Es un user "sistema".
        passwordHash: null,
        role: "MEMBER"
      }
    });
  }

  // 2. Membership en este workspace
  const existingMembership = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: api.workspaceId, userId: aiUser.id } }
  });
  if (!existingMembership) {
    await prisma.membership.create({
      data: {
        workspaceId: api.workspaceId,
        userId: aiUser.id,
        role: "MEMBER"
      }
    });
  }

  // 3. Proyecto buzón. Buscamos por nombre exacto dentro del workspace.
  let inboxProject = await prisma.project.findFirst({
    where: {
      workspaceId: api.workspaceId,
      name: AI_PROJECT_NAME,
      deletedAt: null
    } as any
  });
  if (!inboxProject) {
    inboxProject = await prisma.project.create({
      data: {
        workspaceId: api.workspaceId,
        name: AI_PROJECT_NAME,
        description:
          "Buzón de tareas para NV IA. Cualquier tarea que enlaces a este proyecto (vía 'Compartir con proyecto') será procesada automáticamente por la IA.",
        color: "bg-violet-500"
      }
    });
  }

  // 4. NV IA es ProjectMember del buzón (para que aparezca como asignada
  //    posible y vea la tarea en sus listados).
  const existingPM = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: inboxProject.id, userId: aiUser.id } }
  });
  if (!existingPM) {
    await prisma.projectMember.create({
      data: { projectId: inboxProject.id, userId: aiUser.id, role: "MEMBER" }
    });
  }

  // 5. Guardamos config en Workspace.settings.aiAgent (merge)
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.aiAgent = {
    ...(settings.aiAgent ?? {}),
    userId: aiUser.id,
    inboxProjectId: inboxProject.id,
    model: settings.aiAgent?.model ?? DEFAULT_AGENT_CONFIG.model,
    maxStepsPerRun: settings.aiAgent?.maxStepsPerRun ?? DEFAULT_AGENT_CONFIG.maxStepsPerRun,
    maxTokensPerRun: settings.aiAgent?.maxTokensPerRun ?? DEFAULT_AGENT_CONFIG.maxTokensPerRun
  };
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });

  return NextResponse.json({
    ok: true,
    aiUser: { id: aiUser.id, name: aiUser.name, email: aiUser.email },
    inboxProject: { id: inboxProject.id, name: inboxProject.name },
    config: settings.aiAgent
  });
});

/**
 * GET → devuelve el estado actual de NV IA en el workspace (si está
 * configurada, qué config tiene, contador de runs recientes).
 */
export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) {
    throw new ApiError(403, "forbidden", "Solo admin");
  }
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  const cfg = settings?.aiAgent;
  if (!cfg?.userId) {
    return NextResponse.json({ configured: false });
  }
  const [user, project, runCounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: cfg.userId },
      select: { id: true, name: true, email: true, image: true }
    }),
    prisma.project.findFirst({
      where: { id: cfg.inboxProjectId, workspaceId: api.workspaceId },
      select: { id: true, name: true, deletedAt: true }
    }),
    prisma.aiAgentRun.groupBy({
      by: ["status"],
      where: { workspaceId: api.workspaceId },
      _count: { _all: true }
    })
  ]);
  return NextResponse.json({
    configured: true,
    aiUser: user,
    inboxProject: project,
    config: cfg,
    runCounts: runCounts.reduce(
      (acc, r) => ({ ...acc, [r.status]: r._count._all }),
      {} as Record<string, number>
    )
  });
});
