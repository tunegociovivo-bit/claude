/**
 * GET / PUT /api/v1/admin/sonia-model-routing
 *
 * Configura Workspace.settings.aiAgent.modelRouting.
 * Valores válidos: "always_opus" (default) | "auto" | "cost_saver".
 *
 * No requiere migración — todo va en JSON.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const ALLOWED = ["always_opus", "auto", "cost_saver"] as const;

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const routing = (ws?.settings as any)?.aiAgent?.modelRouting ?? "always_opus";
  return NextResponse.json({ routing });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const routing = String(body?.routing ?? "");
  if (!ALLOWED.includes(routing as any)) {
    return NextResponse.json(
      { error: `routing debe ser uno de: ${ALLOWED.join(", ")}` },
      { status: 400 }
    );
  }
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (!settings.aiAgent) settings.aiAgent = {};
  settings.aiAgent.modelRouting = routing;
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true, routing });
});
