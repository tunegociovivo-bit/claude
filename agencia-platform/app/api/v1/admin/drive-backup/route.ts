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

  if (gd.serviceAccountJsonEncrypted && gd.folderId) {
    try {
      const t = await testDriveConnection(api.workspaceId);
      serviceAccountEmail = t.serviceAccountEmail;
      files = await listDriveFiles({ workspaceId: api.workspaceId, namePrefix: "agencia-hub-" });
    } catch (e: any) {
      listError = e?.message ?? "Error listando archivos";
    }
  }

  return NextResponse.json({
    configured: !!gd.serviceAccountJsonEncrypted && !!gd.folderId,
    folderId: gd.folderId ?? null,
    serviceAccountEmail,
    files,
    listError
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
      const r = await runDriveBackup({ workspaceId: api.workspaceId, kinds });
      return NextResponse.json(r);
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
