import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

async function membership(workspaceId: string, userId?: string) {
  if (!userId) throw new ApiError(401, "unauthenticated", "Usuario no identificado");
  const member = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!member) throw new ApiError(403, "forbidden", "No perteneces a este espacio");
  return member;
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const member = await membership(api.workspaceId, api.userId);
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 7)));
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - days + 1);
  const userFilter = member.role === "ADMIN" ? {} : { userId: api.userId! };
  // Cierra sesiones de agentes que llevan más de 5 minutos sin heartbeat.
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const stale = await prisma.timeTrackerSession.findMany({ where: { workspaceId: api.workspaceId, source: "AGENT", endedAt: null, updatedAt: { lt: staleBefore } }, select: { id: true, updatedAt: true } });
  await Promise.all(stale.map(s => prisma.timeTrackerSession.update({ where: { id: s.id }, data: { endedAt: s.updatedAt } })));

  const [members, projects, sessions, activities, active] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: api.workspaceId },
      select: { userId: true, role: true, user: { select: { name: true, email: true, image: true } } },
      orderBy: { user: { name: "asc" } }
    }),
    prisma.project.findMany({ where: { workspaceId: api.workspaceId }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
    prisma.timeTrackerSession.findMany({
      where: { workspaceId: api.workspaceId, startedAt: { gte: since }, ...userFilter },
      orderBy: { startedAt: "desc" }
    }),
    prisma.timeTrackerActivity.findMany({
      where: { workspaceId: api.workspaceId, bucketStart: { gte: since }, privateMode: false, ...userFilter },
      select: { userId: true, durationSec: true, productive: true, idle: true, appName: true, domain: true }
    }),
    prisma.timeTrackerSession.findMany({ where: { workspaceId: api.workspaceId, endedAt: null, ...userFilter } })
  ]);

  const now = Date.now();
  const byUser = new Map<string, { seconds: number; productive: number; tracked: number; idle: number }>();
  for (const m of members) byUser.set(m.userId, { seconds: 0, productive: 0, tracked: 0, idle: 0 });
  for (const s of sessions) {
    const row = byUser.get(s.userId);
    if (row) row.seconds += Math.max(0, ((s.endedAt?.getTime() ?? now) - s.startedAt.getTime()) / 1000);
  }
  const usage = new Map<string, number>();
  for (const a of activities) {
    const row = byUser.get(a.userId);
    if (row) {
      row.tracked += a.durationSec;
      if (a.productive) row.productive += a.durationSec;
      if (a.idle) row.idle += a.durationSec;
    }
    const key = a.domain || a.appName || "Sin clasificar";
    usage.set(key, (usage.get(key) ?? 0) + a.durationSec);
  }
  return NextResponse.json({
    days,
    isAdmin: member.role === "ADMIN",
    members: members.map((m) => ({
      id: m.userId, name: m.user.name || m.user.email, email: m.user.email, image: m.user.image, role: m.role,
      active: active.some((s) => s.userId === m.userId), ...(byUser.get(m.userId) ?? {})
    })),
    projects,
    sessions,
    topUsage: [...usage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, seconds]) => ({ name, seconds })),
    myActiveSession: active.find((s) => s.userId === api.userId) ?? null
  });
});

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), projectId: z.string().nullable().optional(), note: z.string().max(500).optional(), privateMode: z.boolean().optional() }),
  z.object({ action: z.literal("stop") })
]);

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await membership(api.workspaceId, api.userId);
  const parsed = command.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const open = await prisma.timeTrackerSession.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId!, endedAt: null } });
  if (parsed.data.action === "stop") {
    if (!open) throw new ApiError(409, "not_clocked_in", "No hay una jornada activa");
    return NextResponse.json(await prisma.timeTrackerSession.update({ where: { id: open.id }, data: { endedAt: new Date() } }));
  }
  if (open) throw new ApiError(409, "already_clocked_in", "Ya existe una jornada activa");
  if (parsed.data.projectId) {
    const project = await prisma.project.findFirst({ where: { id: parsed.data.projectId, workspaceId: api.workspaceId }, select: { id: true } });
    if (!project) throw new ApiError(400, "invalid_project", "Proyecto no válido");
  }
  return NextResponse.json(await prisma.timeTrackerSession.create({ data: {
    workspaceId: api.workspaceId, userId: api.userId!, projectId: parsed.data.projectId || null,
    note: parsed.data.note?.trim() || null, isPrivate: parsed.data.privateMode ?? false, source: "WEB"
  } }), { status: 201 });
});
