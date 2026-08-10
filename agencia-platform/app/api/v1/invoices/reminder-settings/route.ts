import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  await requireAdmin(api);
  const workspace = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { invoiceRemindersEnabled: true } });
  return NextResponse.json({ enabled: workspace?.invoiceRemindersEnabled === true });
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const workspace = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { id: true } });
  if (!workspace) throw new ApiError(404, "not_found", "Espacio de trabajo no encontrado");
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { invoiceRemindersEnabled: parsed.data.enabled } });
  return NextResponse.json({ enabled: parsed.data.enabled });
});
