/**
 * GET / PUT /api/v1/admin/sonia-auto-learning-toggle
 * Toggle de Workspace.settings.aiAgent.autoLearningEnabled.
 *
 * Cuando ON, el cron diario sonia-learning-cron analiza los hilos
 * user↔Sonia recientes y extrae lecciones automáticamente.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const enabled = !!(ws?.settings as any)?.aiAgent?.autoLearningEnabled;
  return NextResponse.json({ enabled });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const enabled = !!body?.enabled;
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (!settings.aiAgent) settings.aiAgent = {};
  settings.aiAgent.autoLearningEnabled = enabled;
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, enabled });
});
