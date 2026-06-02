/**
 * Backups del workspace.
 * GET: lista BackupRun (admin)
 * POST: dispara backup manual ahora (admin o cron token)
 *
 * El backup genera JSON de todos los datos del workspace, lo sube a R2
 * (si está configurado) y registra una fila BackupRun. La respuesta
 * incluye downloadUrl (firmada / pública).
 *
 * Si R2 no está configurado, se devuelve el JSON directamente y NO se
 * guarda BackupRun.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { isStorageEnabled } from "@/lib/storage/r2";
import { runWorkspaceBackup } from "@/lib/backup/run";

async function requireAdminOrCron(req: NextRequest, workspaceId: string, userId: string | undefined) {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ") && process.env.INTERNAL_CRON_TOKEN) {
    if (auth.slice(7).trim() === process.env.INTERNAL_CRON_TOKEN) return true;
  }
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
  return true;
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");

  let items: any[] = [];
  try {
    items = await prisma.backupRun.findMany({
      where: { workspaceId: api.workspaceId },
      orderBy: { startedAt: "desc" },
      take: 50
    });
  } catch (e) {
    // La tabla puede no existir aún si el schema no se ha sincronizado;
    // devolvemos lista vacía en vez de romper la página.
    console.error("[backup] listado falló:", e);
  }
  return NextResponse.json({
    items,
    storageEnabled: isStorageEnabled()
  });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdminOrCron(req, api.workspaceId, api.userId);

  const trigger = req.headers.get("x-cron-trigger") === "1" ? "cron" : "manual";

  try {
    const r = await runWorkspaceBackup(api.workspaceId, trigger);
    return NextResponse.json({
      ok: true,
      run: { id: r.runId, sizeBytes: r.sizeBytes, status: "COMPLETED" },
      downloadUrl: r.downloadUrl,
      inlineAvailable: r.inlineAvailable
    });
  } catch (e: any) {
    throw new ApiError(500, "backup_failed", String(e?.message ?? e));
  }
});
