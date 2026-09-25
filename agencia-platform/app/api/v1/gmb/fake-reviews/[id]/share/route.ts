/**
 * POST   /api/v1/gmb/fake-reviews/[id]/share {expiryDays?} → enlace público firmado para el cliente
 *        (el token en claro se devuelve UNA vez; en BD sólo su hash)
 * DELETE /api/v1/gmb/fake-reviews/[id]/share → revoca el enlace
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { expiryFromDays, generateShareToken } from "@/lib/gmb/report-share";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const row = await prisma.gmbFakeReviewAnalysis.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true, status: true } });
  if (!row) throw new ApiError(404, "not_found", "Análisis no encontrado");
  if (row.status !== "done") throw new ApiError(409, "not_ready", "El análisis aún no ha terminado");
  const { token, hash } = generateShareToken();
  const expiresAt = expiryFromDays(Number(body?.expiryDays) || 60);
  await prisma.gmbFakeReviewAnalysis.updateMany({
    where: { id: row.id, workspaceId: api.workspaceId },
    data: { shareTokenHash: hash, shareExpiresAt: expiresAt }
  });
  const origin = process.env.NEXTAUTH_URL?.replace(/\/+$/, "") ?? new URL(req.url).origin;
  return NextResponse.json({ url: `${origin}/informe-resenas/${token}`, expiresAt });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const r = await prisma.gmbFakeReviewAnalysis.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: { shareTokenHash: null, shareExpiresAt: null }
  });
  if (!r.count) throw new ApiError(404, "not_found", "Análisis no encontrado");
  return NextResponse.json({ ok: true });
});
