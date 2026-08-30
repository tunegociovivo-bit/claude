import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const payload = z.object({
  deviceId: z.string().min(4).max(120),
  entries: z.array(z.object({
    bucketStart: z.coerce.date(), durationSec: z.number().int().min(1).max(300),
    appName: z.string().max(160).nullable().optional(), domain: z.string().max(253).nullable().optional(),
    windowTitle: z.string().max(300).nullable().optional(), projectId: z.string().nullable().optional(),
    productive: z.boolean().nullable().optional(), idle: z.boolean().optional(), privateMode: z.boolean().optional()
  })).min(1).max(500)
});

export const POST = withApi({ scope: "time_tracking:write" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "user_required", "La clave del agente debe pertenecer a un usuario");
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const member = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId }, select: { id: true } });
  if (!member) throw new ApiError(403, "forbidden", "Usuario fuera del espacio");
  let accepted = 0;
  for (const e of parsed.data.entries) {
    // En modo privado conservamos únicamente tiempo agregado, sin aplicación,
    // dominio ni título de ventana.
    const identity = {
      workspaceId: api.workspaceId, userId: api.userId, deviceId: parsed.data.deviceId,
      bucketStart: e.bucketStart, appName: e.privateMode ? null : (e.appName ?? null), domain: e.privateMode ? null : (e.domain ?? null)
    };
    const existing = await prisma.timeTrackerActivity.findFirst({ where: identity, select: { id: true } });
    if (existing) {
      await prisma.timeTrackerActivity.update({ where: { id: existing.id }, data: { durationSec: e.durationSec, productive: e.productive, idle: e.idle ?? false } });
    } else {
      await prisma.timeTrackerActivity.create({
      data: { workspaceId: api.workspaceId, userId: api.userId, deviceId: parsed.data.deviceId, bucketStart: e.bucketStart,
        durationSec: e.durationSec, appName: e.privateMode ? null : e.appName, domain: e.privateMode ? null : e.domain,
        windowTitle: e.privateMode ? null : e.windowTitle, projectId: e.projectId, productive: e.productive,
        idle: e.idle ?? false, privateMode: e.privateMode ?? false }
      });
    }
    accepted++;
  }
  return NextResponse.json({ ok: true, accepted });
});
