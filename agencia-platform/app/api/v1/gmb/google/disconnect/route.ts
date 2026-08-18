/**
 * POST /api/v1/gmb/google/disconnect — desconecta la cuenta de Google del workspace.
 * Revoca el token en Google (best-effort), elimina la conexión y audita. NO borra las
 * fichas ya creadas (siguen existiendo; simplemente dejan de sincronizar). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { decryptSecret } from "@/lib/ai/crypto";
import { revokeGoogleToken } from "@/lib/gmb/gbp-oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withApi({ scope: "*", rate: "destructive" }, async (_req, { api }) => {
  const conn = await prisma.gmbGoogleConnection.findUnique({ where: { workspaceId: api.workspaceId } });
  if (!conn) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  // Revocación best-effort en Google (no bloquea la desconexión si falla).
  let revoked = false;
  try {
    const token = decryptSecret(conn.refreshTokenEnc);
    if (token) revoked = await revokeGoogleToken(token);
  } catch {
    revoked = false;
  }

  await prisma.gmbGoogleConnection.deleteMany({ where: { workspaceId: api.workspaceId } });
  await prisma.auditLog.create({
    data: {
      workspaceId: api.workspaceId,
      actorId: api.userId ?? null,
      action: "gmb.google.disconnected",
      targetType: "GmbGoogleConnection",
      meta: { revokedAtGoogle: revoked },
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, revokedAtGoogle: revoked });
});
