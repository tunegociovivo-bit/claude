/**
 * GET/PATCH del guardarraíl de recurrencia de tareas.
 *
 * settings.tasks.autoRecurrence controla si el cron reabre automáticamente las
 * tareas recurrentes (las hace "reaparecer"). Por seguridad está DESACTIVADO
 * por defecto: el tablero no cambia sin consentimiento. Aquí el admin lo
 * consulta y lo activa/desactiva.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const autoRecurrence = (ws?.settings as any)?.tasks?.autoRecurrence === true;
  return NextResponse.json({ autoRecurrence });
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  if (api.userId) {
    const me = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId }, select: { role: true } });
    if (me?.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
  }
  const parsed = z.object({ autoRecurrence: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  settings.tasks = settings.tasks ?? {};
  settings.tasks.autoRecurrence = parsed.data.autoRecurrence;
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, autoRecurrence: parsed.data.autoRecurrence });
});
