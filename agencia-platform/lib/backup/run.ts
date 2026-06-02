/**
 * Ejecuta el backup de UN workspace: genera el dump, lo sube a R2 (si está
 * configurado) y registra/actualiza la fila BackupRun. Extraído del endpoint
 * admin para poder reutilizarlo desde el cron interno (que recorre todos los
 * workspaces) sin pasar por withApi/authenticate.
 *
 * Best-effort con BackupRun: si la tabla no existe o falla la escritura, el
 * backup se genera igualmente.
 */

import { prisma } from "@/lib/db/prisma";
import { generateWorkspaceDump } from "@/lib/backup/dump";
import { isStorageEnabled, signedDownloadUrl, signedUploadUrl, buildS3Key } from "@/lib/storage/r2";

export async function runWorkspaceBackup(
  workspaceId: string,
  trigger: "manual" | "cron"
): Promise<{ runId: string | null; sizeBytes: number; downloadUrl: string | null; inlineAvailable: boolean }> {
  let run: { id: string } | null = null;
  try {
    run = await prisma.backupRun.create({
      data: {
        workspaceId,
        status: "RUNNING",
        trigger,
        destinations: isStorageEnabled() ? "r2" : "local"
      }
    });
  } catch (e) {
    console.error("[backup] no se pudo crear BackupRun (se continúa):", e);
  }

  try {
    const dump = await generateWorkspaceDump(workspaceId);
    const json = JSON.stringify(dump, null, 2);
    const bytes = Buffer.byteLength(json, "utf8");

    let downloadKey: string | null = null;
    let downloadUrl: string | null = null;

    if (isStorageEnabled()) {
      const key = buildS3Key({
        workspaceId,
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

    return { runId: run?.id ?? null, sizeBytes: bytes, downloadUrl, inlineAvailable: !isStorageEnabled() };
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
    throw e;
  }
}
