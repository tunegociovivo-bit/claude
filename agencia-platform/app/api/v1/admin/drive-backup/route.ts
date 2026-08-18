/**
 * GET    - estado actual: configurado? · listar archivos en la carpeta
 * PATCH  - guardar service account JSON + folder ID (admin only)
 * POST   - acciones: { action: "test" | "backup_now" | "cleanup" }
 *
 * Solo admins.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { encryptSecret } from "@/lib/ai/crypto";
import {
  listDriveFiles,
  testDriveConnection,
  parseFolderIdFromUrl
} from "@/lib/integrations/google-drive";
import { runDriveBackup, cleanupOrphanBackups } from "@/lib/backup/drive-rotation";
import { driveOAuthConfigurationIssue, driveOAuthConfigured } from "@/lib/integrations/google-drive-oauth";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const gd: any = (ws?.settings as any)?.integrations?.googleDrive ?? {};

  let files: any[] = [];
  let listError: string | null = null;
  let serviceAccountEmail: string | null = null;

  if ((gd.refreshTokenEncrypted || gd.serviceAccountJsonEncrypted) && gd.folderId) {
    try {
      const t = await testDriveConnection(api.workspaceId);
      serviceAccountEmail = t.serviceAccountEmail;
      files = await listDriveFiles({ workspaceId: api.workspaceId, namePrefix: "agencia-hub-" });
    } catch (e: any) {
      listError = e?.message ?? "Error listando archivos";
    }
  }

  const latestJob = await prisma.backgroundJob.findFirst({
    where: { workspaceId: api.workspaceId, kind: "backup.google_drive" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      progressPct: true,
      progressMsg: true,
      result: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      createdAt: true
    }
  });

  return NextResponse.json({
    configured: !!(gd.refreshTokenEncrypted || gd.serviceAccountJsonEncrypted) && !!gd.folderId,
    authMode: gd.refreshTokenEncrypted ? "oauth" : gd.serviceAccountJsonEncrypted ? "service_account" : null,
    oauthConfigured: driveOAuthConfigured(),
    oauthConfigurationIssue: driveOAuthConfigurationIssue(),
    accountEmail: gd.accountEmail ?? serviceAccountEmail,
    folderId: gd.folderId ?? null,
    serviceAccountEmail,
    files,
    listError,
    latestJob
  });
});

const patchSchema = z.object({
  // JSON entero del service account. Si null/empty → borrar.
  serviceAccountJson: z.string().nullable().optional(),
  // Folder ID o URL de Drive
  folder: z.string().nullable().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ws?.settings ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.googleDrive = settings.integrations.googleDrive ?? {};
  const gd = settings.integrations.googleDrive;

  if (parsed.data.serviceAccountJson !== undefined) {
    if (parsed.data.serviceAccountJson === null || parsed.data.serviceAccountJson === "") {
      delete gd.serviceAccountJsonEncrypted;
    } else {
      // Validar que parsea
      let sa: any;
      try {
        sa = JSON.parse(parsed.data.serviceAccountJson);
      } catch {
        throw new ApiError(400, "bad_json", "El service account JSON no parsea");
      }
      if (!sa.client_email || !sa.private_key) {
        throw new ApiError(400, "bad_sa", "Service account JSON sin client_email o private_key");
      }
      gd.serviceAccountJsonEncrypted = encryptSecret(parsed.data.serviceAccountJson);
      delete gd.refreshTokenEncrypted;
      delete gd.accountEmail;
    }
  }
  if (parsed.data.folder !== undefined) {
    if (parsed.data.folder === null || parsed.data.folder === "") {
      delete gd.folderId;
    } else {
      gd.folderId = parseFolderIdFromUrl(parsed.data.folder);
    }
  }

  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});

const postSchema = z.object({
  action: z.enum(["test", "backup_now", "cleanup"]),
  kinds: z.array(z.enum(["daily", "weekly", "monthly"])).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    if (parsed.data.action === "test") {
      const r = await testDriveConnection(api.workspaceId);
      return NextResponse.json(r);
    }
    if (parsed.data.action === "backup_now") {
      const kinds = parsed.data.kinds ?? ["daily"];
      const active = await prisma.backgroundJob.findFirst({
        where: {
          workspaceId: api.workspaceId,
          kind: "backup.google_drive",
          status: { in: ["PENDING", "RUNNING"] }
        },
        orderBy: { createdAt: "desc" }
      });
      if (active) {
        return NextResponse.json({ ok: true, jobId: active.id, status: active.status }, { status: 202 });
      }
      const job = await prisma.backgroundJob.create({
        data: {
          workspaceId: api.workspaceId,
          userId: api.userId ?? null,
          kind: "backup.google_drive",
          status: "PENDING",
          progressPct: 0,
          progressMsg: "Copia en cola",
          request: { kinds }
        }
      });
      void runDriveBackupJob(job.id, api.workspaceId, kinds);
      return NextResponse.json({ ok: true, jobId: job.id, status: job.status }, { status: 202 });
    }
    if (parsed.data.action === "cleanup") {
      const r = await cleanupOrphanBackups(api.workspaceId);
      return NextResponse.json(r);
    }
    throw new ApiError(400, "unknown_action", parsed.data.action);
  } catch (e: any) {
    throw new ApiError(500, "drive_error", e?.message ?? "Error en Drive");
  }
});

async function runDriveBackupJob(jobId: string, workspaceId: string, kinds: Array<"daily" | "weekly" | "monthly">) {
  let lastProgressPct = -1;
  let lastProgressAt = 0;
  try {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), progressPct: 1, progressMsg: "Iniciando copia completa" }
    });
    const result = await runDriveBackup({
      workspaceId,
      kinds,
      onProgress: async (progressMsg, progressPct) => {
        const now = Date.now();
        if (progressPct < 100 && progressPct - lastProgressPct < 2 && now - lastProgressAt < 1000) return;
        lastProgressPct = progressPct;
        lastProgressAt = now;
        await prisma.backgroundJob.update({
          where: { id: jobId },
          data: { progressPct, progressMsg }
        });
      }
    });
    const failed = result.results.filter((item) => !item.ok);
    if (failed.length > 0) {
      throw new Error(failed.map((item) => `${item.kind}: ${item.error ?? "falló"}`).join(" · "));
    }
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progressPct: 100,
        progressMsg: "Copia completa guardada en Google Drive",
        result: result as any
      }
    });
  } catch (error: any) {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        progressMsg: "La copia de Google Drive ha fallado",
        errorMessage: String(error?.message ?? error).slice(0, 2000)
      }
    }).catch(() => {});
  }
}
