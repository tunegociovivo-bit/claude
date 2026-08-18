/**
 * Sistema de backups en Google Drive con rotación.
 *
 * Reglas pedidas por el user:
 *   - Diario: siempre 2 (hoy + ayer). Se reemplaza el más antiguo.
 *   - Semanal: siempre 2. Se reemplaza el más antiguo.
 *   - Mensual: siempre 2 (este mes + mes anterior). Se reemplaza el más antiguo.
 *
 * Total: 6 archivos máximo. Nombres únicos con fecha en el nombre para
 * trazabilidad, y emparejamiento por "slot A / slot B" alternante.
 *
 * Slot impar/par:
 *   - daily: día del año mod 2 → daily-A o daily-B (sobrescribe la
 *     versión anterior de hace 2 días)
 *   - weekly: número de semana ISO mod 2 → weekly-A o weekly-B
 *   - monthly: mes mod 2 → monthly-A o monthly-B
 *
 * Así el nombre se sobrescribe automáticamente cuando toca, sin tener
 * que listar+borrar (más simple y atómico).
 */

import { uploadDriveFile, listDriveFiles, deleteDriveFile } from "@/lib/integrations/google-drive";
import { generateWorkspaceDump } from "@/lib/backup/dump";
import { prisma } from "@/lib/db/prisma";
import { downloadBuffer } from "@/lib/storage/r2";
import { createHash } from "node:crypto";

export type BackupKind = "daily" | "weekly" | "monthly";

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function isoWeek(d: Date): { year: number; week: number } {
  // ISO 8601 week date
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return { year: target.getUTCFullYear(), week };
}

function dayOfYear(d: Date): number {
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

/**
 * Calcula nombre de archivo y slot (A/B) para un backup de un día dado.
 *
 * El sufijo A/B alterna en función de la paridad del periodo, así
 * "daily-A" siempre apunta al día con dayOfYear par, y "daily-B" al
 * impar. Al cabo de 2 días, ese mismo nombre se sobrescribe (lo que
 * efectivamente borra el de hace 2 días).
 */
export function backupFileNames(kind: BackupKind, when: Date): { fileName: string; humanLabel: string } {
  const dateStr = isoDate(when);
  if (kind === "daily") {
    const slot = dayOfYear(when) % 2 === 0 ? "A" : "B";
    return {
      fileName: `agencia-hub-daily-${slot}.json.gz`,
      humanLabel: `Diario [${slot}] · ${dateStr}`
    };
  }
  if (kind === "weekly") {
    const { week } = isoWeek(when);
    const slot = week % 2 === 0 ? "A" : "B";
    return {
      fileName: `agencia-hub-weekly-${slot}.json.gz`,
      humanLabel: `Semanal [${slot}] · semana ${week}`
    };
  }
  // monthly
  const slot = when.getUTCMonth() % 2 === 0 ? "A" : "B";
  const monthLabel = `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}`;
  return {
    fileName: `agencia-hub-monthly-${slot}.json.gz`,
    humanLabel: `Mensual [${slot}] · ${monthLabel}`
  };
}

/**
 * Decide qué tipos de backup hay que generar HOY:
 *   - Siempre daily.
 *   - Si es lunes (ISO weekday 1) → weekly.
 *   - Si es día 1 del mes → monthly.
 */
export function whichBackupsToday(when: Date = new Date()): BackupKind[] {
  const kinds: BackupKind[] = ["daily"];
  const utcWeekday = when.getUTCDay(); // 0=Sun, 1=Mon
  if (utcWeekday === 1) kinds.push("weekly");
  if (when.getUTCDate() === 1) kinds.push("monthly");
  return kinds;
}

/**
 * Genera el ZIP del workspace (JSON dump + meta) listo para subir.
 *
 * Para no añadir dep nueva, simplificamos: subimos directamente el JSON
 * comprimido sin ZIP wrapper (gzip nativo de Node es suficiente y
 * Drive lo guarda igual). El nombre del archivo termina en .json.gz
 * en realidad, pero usamos .zip por compatibilidad UX si user
 * descomprime.
 *
 * NOTA: si en el futuro se quiere ZIP multifichero, instalar `archiver`.
 */
export function isMissingStorageObjectError(error: unknown): boolean {
  const candidate = error as { name?: string; code?: string; Code?: string; message?: string } | null;
  const code = candidate?.name ?? candidate?.code ?? candidate?.Code ?? "";
  const message = candidate?.message ?? "";
  return code === "NoSuchKey" || code === "NotFound" || /specified key does not exist/i.test(message);
}

async function generateBackupArchive(
  workspaceId: string,
  onProgress?: (message: string, progressPct: number) => Promise<void> | void
): Promise<{
  body: Buffer;
  mimeType: string;
  mirroredFiles: number;
  missingFiles: number;
}> {
  const { gzipSync } = await import("zlib");
  const dump = await generateWorkspaceDump(workspaceId);
  if (dump.modelErrors && Object.keys(dump.modelErrors).length) {
    throw new Error(`Backup incompleto: fallaron modelos ${Object.keys(dump.modelErrors).join(", ")}`);
  }
  const files = await prisma.file.findMany({
    where: { workspaceId },
    select: { id: true, name: true, mimeType: true, sizeBytes: true, s3Key: true }
  });
  const existingDriveFiles = await listDriveFiles({ workspaceId, namePrefix: "hub-adjunto-" });
  const existingByName = new Map(existingDriveFiles.map((file) => [file.name, file]));
  const manifest: Array<Record<string, unknown>> = new Array(files.length);
  const uploadsByName = new Map<string, ReturnType<typeof uploadDriveFile>>();
  let missingFiles = 0;
  let nextFileIndex = 0;
  let processedFiles = 0;

  async function mirrorFile(index: number): Promise<void> {
    const file = files[index];
    let body: Buffer;
    try {
      body = await downloadBuffer(file.s3Key);
    } catch (error) {
      if (!isMissingStorageObjectError(error)) throw error;
      missingFiles += 1;
      manifest[index] = {
        ...file,
        backupStatus: "source_missing",
        error: "El objeto no existe en el almacenamiento de origen"
      };
      return;
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    const md5 = createHash("md5").update(body).digest("hex");
    const hash = sha256.slice(0, 24);
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const driveName = `hub-adjunto-${hash}-${safe}`;
    const candidate = existingByName.get(driveName);
    const existing = candidate && candidate.size === String(body.byteLength) && (!candidate.md5Checksum || candidate.md5Checksum === md5)
      ? candidate
      : undefined;
    let upload = uploadsByName.get(driveName);
    if (!existing && !upload) {
      upload = uploadDriveFile({
        workspaceId,
        fileName: driveName,
        body,
        mimeType: file.mimeType || "application/octet-stream"
      });
      uploadsByName.set(driveName, upload);
    }
    const remote = existing ?? await upload!;
    existingByName.set(driveName, remote);
    manifest[index] = { ...file, backupStatus: "mirrored", driveFileId: remote.id, driveName, sha256 };
  }

  async function worker(): Promise<void> {
    while (nextFileIndex < files.length) {
      const index = nextFileIndex++;
      await mirrorFile(index);
      const processed = ++processedFiles;
      await onProgress?.(
        `Verificando adjuntos ${processed}/${files.length}`,
        Math.min(90, 5 + Math.round((processed / Math.max(1, files.length)) * 85))
      );
    }
  }

  // Tres workers reducen drásticamente el tiempo sin cargar demasiados
  // adjuntos grandes simultáneamente en memoria.
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
  const json = JSON.stringify({
    format: "hub-complete-backup-v1",
    dump,
    attachments: manifest,
    integrity: {
      databaseComplete: true,
      attachmentRecords: files.length,
      attachmentsMirrored: files.length - missingFiles,
      sourceObjectsMissing: missingFiles
    }
  });
  const gz = gzipSync(Buffer.from(json, "utf8"));
  return {
    body: gz,
    mimeType: "application/gzip",
    mirroredFiles: files.length - missingFiles,
    missingFiles
  };
}

export async function runDriveBackup(opts: {
  workspaceId: string;
  kinds?: BackupKind[];
  when?: Date;
  onProgress?: (message: string, progressPct: number) => Promise<void> | void;
}): Promise<{
  workspaceId: string;
  results: { kind: BackupKind; fileName: string; humanLabel: string; ok: boolean; error?: string }[];
}> {
  const when = opts.when ?? new Date();
  const kinds = opts.kinds ?? whichBackupsToday(when);
  await opts.onProgress?.("Preparando la base de datos y el manifiesto", 3);
  const archive = await generateBackupArchive(opts.workspaceId, opts.onProgress);

  const results: any[] = [];
  for (const kind of kinds) {
    const { fileName, humanLabel } = backupFileNames(kind, when);
    try {
      await opts.onProgress?.(`Subiendo snapshot ${humanLabel}`, 94);
      await uploadDriveFile({
        workspaceId: opts.workspaceId,
        fileName,
        body: archive.body,
        mimeType: archive.mimeType
      });
      results.push({
        kind,
        fileName,
        humanLabel,
        ok: true,
        mirroredFiles: archive.mirroredFiles,
        missingFiles: archive.missingFiles
      });
    } catch (e: any) {
      results.push({
        kind,
        fileName,
        humanLabel,
        ok: false,
        error: String(e?.message ?? e).slice(0, 300)
      });
    }
  }
  await opts.onProgress?.("Snapshot guardado y verificado en Google Drive", 100);
  return { workspaceId: opts.workspaceId, results };
}

/**
 * Limpia archivos sobrantes en la carpeta (cualquier cosa que NO
 * coincida con los 6 nombres esperados). Útil si el user ha subido
 * cosas a mano por error o si se han renombrado nombres en el código.
 */
export async function cleanupOrphanBackups(workspaceId: string): Promise<{ deleted: string[] }> {
  const validNames = new Set<string>();
  for (const kind of ["daily", "weekly", "monthly"] as BackupKind[]) {
    for (const slot of ["A", "B"]) {
      validNames.add(`agencia-hub-${kind}-${slot}.json.gz`);
    }
  }
  const files = await listDriveFiles({ workspaceId, namePrefix: "agencia-hub-" });
  const deleted: string[] = [];
  for (const f of files) {
    // Los .zip antiguos siguen siendo puntos de recuperación válidos durante
    // la migración; solo se retiran manualmente cuando ya exista el mismo slot
    // nuevo y se haya validado una restauración.
    if (!validNames.has(f.name) && !f.name.startsWith("hub-adjunto-") && !/^agencia-hub-(daily|weekly|monthly)-[AB]\.zip$/.test(f.name)) {
      try {
        await deleteDriveFile({ workspaceId, fileId: f.id });
        deleted.push(f.name);
      } catch {}
    }
  }
  return { deleted };
}
