/**
 * Agregaciones de uso de IA: gasto total, por proyecto y por trabajador,
 * con buckets diarios/semanales/mensuales/anuales.
 *
 * Query params:
 *   ?period=daily|weekly|monthly|yearly   (default: monthly)
 *   ?days=N (límite de antigüedad, default 365)
 *
 * Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

type Bucket = "daily" | "weekly" | "monthly" | "yearly";

function bucketKey(d: Date, period: Bucket): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (period === "daily") return `${y}-${pad(m)}-${pad(day)}`;
  if (period === "monthly") return `${y}-${pad(m)}`;
  if (period === "yearly") return `${y}`;
  // weekly: año + número ISO de semana aproximado
  const onejan = new Date(Date.UTC(y, 0, 1));
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) / 7);
  return `${y}-W${pad(week)}`;
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");

  const url = new URL(req.url);
  const period = ((url.searchParams.get("period") ?? "monthly") as Bucket);
  const days = Math.min(Number(url.searchParams.get("days") ?? 365), 1095);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const rows = await prisma.aiUsage.findMany({
    where: { workspaceId: api.workspaceId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50_000
  });

  // Agregaciones
  let total = 0;
  const byBucket = new Map<string, number>();
  const byProject = new Map<string, number>();
  const byUser = new Map<string, number>();
  const byFeature = new Map<string, number>();
  const byModel = new Map<string, number>();

  for (const r of rows) {
    total += r.costMicros;
    const bk = bucketKey(r.createdAt, period);
    byBucket.set(bk, (byBucket.get(bk) ?? 0) + r.costMicros);
    if (r.projectId) byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + r.costMicros);
    if (r.userId) byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + r.costMicros);
    byFeature.set(r.feature, (byFeature.get(r.feature) ?? 0) + r.costMicros);
    byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.costMicros);
  }

  // Resolvemos nombres
  const projectIds = Array.from(byProject.keys());
  const userIds = Array.from(byUser.keys());
  const [projects, users] = await Promise.all([
    projectIds.length > 0
      ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    userIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([])
  ]);

  const projMap = new Map(projects.map((p) => [p.id, p.name]));
  const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email]));

  return NextResponse.json({
    period,
    days,
    totalMicros: total,
    buckets: Array.from(byBucket.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => ({ key, value })),
    byProject: Array.from(byProject.entries())
      .map(([id, value]) => ({ id, name: projMap.get(id) ?? "—", value }))
      .sort((a, b) => b.value - a.value),
    byUser: Array.from(byUser.entries())
      .map(([id, value]) => ({ id, name: userMap.get(id) ?? "—", value }))
      .sort((a, b) => b.value - a.value),
    byFeature: Array.from(byFeature.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value),
    byModel: Array.from(byModel.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
  });
});
