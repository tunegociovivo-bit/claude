import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { signedDownloadUrl } from "@/lib/storage/r2";

const policySchema = z.object({
  trackingEnabled: z.boolean(), collectApps: z.boolean(), collectDomains: z.boolean(),
  collectWindowTitles: z.boolean(), collectIdle: z.boolean(), screenshotsEnabled: z.boolean(),
  screenshotInterval: z.number().int().min(2).max(120), screenshotJitter: z.number().int().min(0).max(50),
  blurScreenshots: z.boolean(), retentionDays: z.number().int().min(1).max(90),
  allowPrivateMode: z.boolean(), excludedApps: z.array(z.string().min(1).max(120)).max(100)
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
  const since = new Date(); since.setDate(since.getDate() - 30); since.setHours(0,0,0,0);
  const [policy, sessions, activities, screenshots] = await Promise.all([
    prisma.timeTrackerPolicy.findUnique({ where: { userId } }),
    prisma.timeTrackerSession.findMany({ where: { workspaceId: api.workspaceId, userId, startedAt: { gte: since } }, orderBy: { startedAt: "desc" } }),
    prisma.timeTrackerActivity.findMany({ where: { workspaceId: api.workspaceId, userId, bucketStart: { gte: since }, privateMode: false }, orderBy: { bucketStart: "desc" }, take: 5000 }),
    prisma.timeTrackerScreenshot.findMany({ where: { workspaceId: api.workspaceId, userId, expiresAt: { gt: new Date() } }, orderBy: { capturedAt: "desc" }, take: 50 })
  ]);
  const usage = new Map<string, number>();
  for (const a of activities) { const key = a.domain || a.appName || "Sin clasificar"; usage.set(key, (usage.get(key) ?? 0) + a.durationSec); }
  return NextResponse.json({
    user: { id: userId, ...member.user }, policy: policy ?? {
      trackingEnabled:true, collectApps:true, collectDomains:true, collectWindowTitles:false, collectIdle:true,
      screenshotsEnabled:true, screenshotInterval:10, screenshotJitter:20, blurScreenshots:false,
      retentionDays:30, allowPrivateMode:true, excludedApps:[]
    }, sessions, activities: activities.slice(0, 500),
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
