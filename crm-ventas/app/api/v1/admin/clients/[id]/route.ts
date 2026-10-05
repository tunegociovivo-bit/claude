import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireOperator } from "@/lib/auth";
import { normalizeAdminNotes, normalizeClientName } from "@/lib/admin/usage";
import { CONTENT_MODULES, setModules, type EnabledModules } from "@/lib/modules";
import { patchWorkspaceSettings } from "@/lib/content/settings";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const changesBlock = typeof body.isBlocked === "boolean";
  const changesNotes = typeof body.adminNotes === "string";
  const changesName = typeof body.name === "string";
  const name = changesName ? normalizeClientName(body.name) : "";
  if (changesName && !name) return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
  const modulesPatch: Partial<EnabledModules> = {};
  if (body.modules && typeof body.modules === "object") {
    for (const key of CONTENT_MODULES) if (typeof body.modules[key] === "boolean") modulesPatch[key] = body.modules[key];
  }
  const changesModules = Object.keys(modulesPatch).length > 0;
  // Tope mensual de IA de contenidos (USD). null = vuelve al valor por defecto.
  const changesAiLimit = "contentAiMonthlyLimitUsd" in body;
  const aiLimit = body.contentAiMonthlyLimitUsd === null || body.contentAiMonthlyLimitUsd === "" ? null : Number(body.contentAiMonthlyLimitUsd);
  if (changesAiLimit && aiLimit !== null && (!Number.isFinite(aiLimit) || aiLimit < 0 || aiLimit > 100000)) {
    return NextResponse.json({ error: "Límite de IA no válido" }, { status: 400 });
  }
  if (!changesBlock && !changesNotes && !changesName && !changesModules && !changesAiLimit) return NextResponse.json({ error: "No hay cambios válidos" }, { status: 400 });
  if (!(await prisma.workspace.findUnique({ where: { id: params.id }, select: { id: true } }))) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }
  const modules = changesModules ? await setModules(params.id, modulesPatch) : undefined;
  if (changesAiLimit) {
    await patchWorkspaceSettings(params.id, (settings) => {
      if (aiLimit === null) delete settings.contentAiMonthlyLimitUsd;
      else settings.contentAiMonthlyLimitUsd = aiLimit;
    });
  }
  if (!changesBlock && !changesNotes && !changesName) return NextResponse.json({ ok: true, modules });
  const workspace = await prisma.workspace.update({
    where: { id: params.id },
    data: {
      ...(changesBlock ? { isBlocked: body.isBlocked, blockedAt: body.isBlocked ? new Date() : null } : {}),
      ...(changesNotes ? { adminNotes: normalizeAdminNotes(body.adminNotes) || null } : {}),
      ...(changesName ? { name } : {}),
    },
    select: { id: true, name: true, isBlocked: true, adminNotes: true },
  });
  return NextResponse.json({ ok: true, workspace, modules });
}
