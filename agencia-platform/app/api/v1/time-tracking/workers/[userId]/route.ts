import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { signedDownloadUrl } from "@/lib/storage/r2";

const clamp = (value: number, min: number, max: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};
const bool = z.coerce.boolean();
const policySchema = z.object({
  trackingEnabled: bool.default(true),
  collectApps: bool.default(true),
  collectDomains: bool.default(true),
  collectWindowTitles: bool.default(false),
  collectIdle: bool.default(true),
  screenshotsEnabled: bool.default(true),
  screenshotInterval: z.coerce.number().transform(value => clamp(value, 2, 120, 10)).default(10),
  screenshotJitter: z.coerce.number().transform(value => clamp(value, 0, 50, 20)).default(20),
  blurScreenshots: bool.default(false),
  retentionDays: z.coerce.number().transform(value => clamp(value, 1, 90, 30)).default(30),
  allowPrivateMode: bool.default(true),
  excludedApps: z.array(z.coerce.string().transform(value => value.trim()).pipe(z.string().min(1).max(120))).max(100).default([])
});

async function requireAdmin(workspaceId: string, actorId?: string) {
  const m = await prisma.membership.findFirst({ where: { workspaceId, userId: actorId, role: "ADMIN" }, select: { id: true } });
  if (!m) throw new ApiError(403, "forbidden", "Acceso restringido a administradores");
}

export const GET = withApi({ scope: "*" }, async (_req, { api, params }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const userId = params.userId;
  const member = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId }, include: { user: { select: { name: true, email: true, image: true } } } });
  if (!member) throw new ApiError(404, "not_found", "Trabajador no encontrado");
  const since = new Date(); since.setDate(since.getDate() - 90); since.setHours(0,0,0,0);
  const [policy, sessions, activities, screenshots] = await Promise.all([
    prisma.timeTrackerPolicy.findUnique({ where: { userId } }),
    prisma.timeTrackerSession.findMany({ where: { workspaceId: api.workspaceId, userId, startedAt: { gte: since } }, orderBy: { startedAt: "desc" } }),
    prisma.timeTrackerActivity.findMany({ where: { workspaceId: api.workspaceId, userId, bucketStart: { gte: since }, privateMode: false }, orderBy: { bucketStart: "desc" }, take: 10000 }),
    prisma.timeTrackerScreenshot.findMany({ where: { workspaceId: api.workspaceId, userId, capturedAt: { gte: since }, expiresAt: { gt: new Date() } }, orderBy: { capturedAt: "desc" }, take: 500 })
  ]);
  const usage = new Map<string, number>();
  for (const a of activities) { const key = a.domain || a.appName || "Sin clasificar"; usage.set(key, (usage.get(key) ?? 0) + a.durationSec); }
  return NextResponse.json({
    user: { id: userId, ...member.user }, policy: policy ?? {
      trackingEnabled:true, collectApps:true, collectDomains:true, collectWindowTitles:false, collectIdle:true,
      screenshotsEnabled:true, screenshotInterval:10, screenshotJitter:20, blurScreenshots:false,
      retentionDays:30, allowPrivateMode:true, excludedApps:[]
    }, sessions, activities,
    topUsage: [...usage.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([name,seconds])=>({name,seconds})),
    screenshots: await Promise.all(screenshots.map(async s => ({ id:s.id,capturedAt:s.capturedAt,appName:s.appName,blurred:s.blurred,url:await signedDownloadUrl(s.s3Key,900) })))
  });
});

export const PATCH = withApi({ scope: "*" }, async (req, { api, params }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const parsed = policySchema.safeParse(await req.json().catch(()=>null));
  if (!parsed.success) throw new ApiError(400,"validation_error",parsed.error.message);
  const member = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: params.userId }, select:{id:true} });
  if (!member) throw new ApiError(404,"not_found","Trabajador no encontrado");
  const policy = await prisma.timeTrackerPolicy.upsert({ where:{userId:params.userId}, create:{workspaceId:api.workspaceId,userId:params.userId,...parsed.data}, update:parsed.data });
  return NextResponse.json(policy);
});
