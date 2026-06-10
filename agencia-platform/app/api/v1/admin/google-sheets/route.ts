/**
 * Configuración de la integración Google Sheets (para que Sonia pueda
 * leer/escribir en hojas de cálculo).
 *
 * GET    - estado: ¿configurado? · email del service account · si reusa el de Drive
 * PATCH  - guardar/limpiar el service account JSON (cifrado). Solo admins.
 * POST   - { action: "test", spreadsheet: "<id|url>" } comprueba acceso a una hoja.
 *
 * El service account NUNCA se guarda en claro: se cifra con encryptSecret
 * (AES-256-GCM) en workspace.settings.integrations.googleSheets.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";
import { testSheetsConnection } from "@/lib/integrations/google-sheets";
import { requireAdminCardAccess } from "@/lib/api/admin-access";

const CARD_HREF = "/admin/integrations/google-sheets";

async function requireAccess(workspaceId: string, userId: string | undefined) {
  await requireAdminCardAccess(workspaceId, userId, CARD_HREF);
}

function emailFromEncrypted(enc?: string): string | null {
  if (!enc) return null;
  try {
    const sa = JSON.parse(decryptSecret(enc) || "{}");
    return sa.client_email ?? null;
  } catch {
    return null;
  }
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAccess(api.workspaceId, api.userId);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const integrations: any = (ws?.settings as any)?.integrations ?? {};
  const ownEnc = integrations?.googleSheets?.serviceAccountJsonEncrypted;
  const driveEnc = integrations?.googleDrive?.serviceAccountJsonEncrypted;
  const effectiveEnc = ownEnc ?? driveEnc;

  return NextResponse.json({
    configured: !!effectiveEnc,
    usingDriveServiceAccount: !ownEnc && !!driveEnc,
    serviceAccountEmail: emailFromEncrypted(effectiveEnc)
  });
});

const patchSchema = z.object({
  // JSON entero del service account. null/"" → borrar el propio (vuelve a usar el de Drive si lo hay).
  serviceAccountJson: z.string().nullable().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAccess(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ws?.settings ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.googleSheets = settings.integrations.googleSheets ?? {};
  const gs = settings.integrations.googleSheets;

  if (parsed.data.serviceAccountJson !== undefined) {
    if (parsed.data.serviceAccountJson === null || parsed.data.serviceAccountJson === "") {
      delete gs.serviceAccountJsonEncrypted;
    } else {
      let sa: any;
      try {
        sa = JSON.parse(parsed.data.serviceAccountJson);
      } catch {
        throw new ApiError(400, "bad_json", "El service account JSON no parsea");
      }
      if (!sa.client_email || !sa.private_key) {
        throw new ApiError(400, "bad_sa", "Service account JSON sin client_email o private_key");
      }
      gs.serviceAccountJsonEncrypted = encryptSecret(parsed.data.serviceAccountJson);
    }
  }

  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});

const postSchema = z.object({
  action: z.literal("test"),
  spreadsheet: z.string().min(1)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAccess(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const r = await testSheetsConnection({
      workspaceId: api.workspaceId,
      spreadsheetId: parsed.data.spreadsheet
    });
    return NextResponse.json(r);
  } catch (e: any) {
    throw new ApiError(500, "sheets_error", e?.message ?? "Error en Sheets");
  }
});
