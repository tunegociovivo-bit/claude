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
import { generateWorkspaceDump } from "@/lib/backup/dump";
import { isStorageEnabled, signedDownloadUrl, signedUploadUrl, buildS3Key } from "@/lib/storage/r2";

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

  // El registro BackupRun es best-effort: si su tabla no existe (schema sin
  // sincronizar) o falla la escritura, el backup debe generarse igualmente —
  // no queremos devolver un 500 genérico por no poder anotar la fila.
  let run: { id: string } | null = null;
  try {
    run = await prisma.backupRun.create({
      data: {
        workspaceId: api.workspaceId,
        status: "RUNNING",
        trigger,
        destinations: isStorageEnabled() ? "r2" : "local"
      }
    });
  } catch (e) {
    console.error("[backup] no se pudo crear BackupRun (se continúa):", e);
  }

  try {
    const dump = await generateWorkspaceDump(api.workspaceId);
    const json = JSON.stringify(dump, null, 2);
    const bytes = Buffer.byteLength(json, "utf8");

    let downloadKey: string | null = null;
    let downloadUrl: string | null = null;

    if (isStorageEnabled()) {
      // Subir a R2 vía PUT directo desde el servidor (no presigned, somos servidor)
      const key = buildS3Key({
        workspaceId: api.workspaceId,
        targetType: "BACKUP",
        targetId: run?.id ?? "adhoc",
        filename: `backup-${dump.workspaceName}-${run?.id ?? Date.now()}.json`
      });
      const presign = await signedUploadUrl(key, "application/json");
      const putRes = await fetch(presign, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: json
      });
      if (!putRes.ok) {
        throw new Error(`R2 PUT falló: ${putRes.status}`);
      }
      downloadKey = key;
      downloadUrl = await signedDownloadUrl(key);
    }

    if (run) {
      try {
        await prisma.backupRun.update({
          where: { id: run.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            sizeBytes: bytes,
            downloadKey: downloadKey ?? undefined
          }
        });
      } catch (e) {
        console.error("[backup] no se pudo actualizar BackupRun:", e);
      }
    }

    return NextResponse.json({
      ok: true,
      run: { id: run?.id ?? null, sizeBytes: bytes, status: "COMPLETED" },
      // Si no hay R2, el cliente puede pedir /download al endpoint local
      downloadUrl,
      inlineAvailable: !isStorageEnabled()
    });
  } catch (e: any) {
    if (run) {
      try {
        await prisma.backupRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: String(e?.message ?? e).slice(0, 500)
          }
        });
      } catch {}
    }
    console.error("[backup] fallo:", e);
    throw new ApiError(500, "backup_failed", String(e?.message ?? e));
  }
});
