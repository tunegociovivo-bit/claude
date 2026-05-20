/**
 * GET /api/v1/admin/credentials-health
 *
 * Estado de salud de las credenciales/integraciones del workspace: valida
 * cada una con una llamada barata a su endpoint y, para Meta, añade la fecha
 * de caducidad del token (MetaConnection.expiresAt). Para el panel de
 * Infraestructura — ver de un vistazo qué token está a punto de caducar o ya
 * falla, antes de que rompa un run de Sonia.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { validateWorkspaceCredentials } from "@/lib/credentials/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const health = await validateWorkspaceCredentials({ workspaceId: api.workspaceId });

  // Caducidad del token de Meta (si hay conexión).
  let metaExpiresAt: string | null = null;
  let metaUserId: string | null = null;
  try {
    const conns = await prisma.metaConnection.findMany({
      where: { workspaceId: api.workspaceId },
      orderBy: { createdAt: "desc" },
      select: { expiresAt: true, metaUserId: true }
    });
    const now = new Date();
    const best = conns.find((c) => !c.expiresAt || c.expiresAt > now) ?? conns[0];
    if (best) {
      metaExpiresAt = best.expiresAt ? best.expiresAt.toISOString() : null; // null = no caduca
      metaUserId = best.metaUserId ?? null;
    }
  } catch {
    /* sin conexión Meta */
  }

  const checks = [
    ...health.valid.map((c) => ({ integration: c.integration, ok: true as const, detail: (c as any).detail ?? null })),
    ...health.invalid.map((c) => ({ integration: c.integration, ok: false as const, reason: (c as any).reason ?? "fallo" }))
  ];

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    checks,
    meta: { expiresAt: metaExpiresAt, metaUserId }
  });
});
