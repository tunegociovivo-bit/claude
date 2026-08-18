/**
 * Enlaces compartibles del informe white-label.
 *  POST { month?, expiryDays?, includePII? } → crea un enlace con token (se muestra UNA vez); en BD
 *    solo se guarda el hash. GET → lista de enlaces (sin token). DELETE ?shareId= → revoca.
 * Tenant-scoped. Sin PII por defecto.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { generateShareToken, expiryFromDays } from "@/lib/gmb/report-share";

export const dynamic = "force-dynamic";

const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), expiryDays: z.number().int().min(1).max(365).optional(), includePII: z.boolean().optional() });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { token, hash } = generateShareToken();
  const expiresAt = expiryFromDays(parsed.data.expiryDays ?? 30);
  await prisma.gmbReportShare.create({ data: { workspaceId: api.workspaceId, clientId: client.id, tokenHash: hash, month: parsed.data.month ?? null, includePII: parsed.data.includePII ?? false, expiresAt, createdById: api.userId ?? null } });
  const origin = new URL(req.url).origin;
  // El token en claro se devuelve SOLO aquí; nunca se vuelve a mostrar ni se guarda.
  return NextResponse.json({ ok: true, url: `${origin}/gmb-report/${token}`, apiUrl: `${origin}/api/v1/gmb/public/report/${token}`, expiresAt, includePII: parsed.data.includePII ?? false });
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const shares = await prisma.gmbReportShare.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, month: true, includePII: true, expiresAt: true, revokedAt: true, createdAt: true } });
  return NextResponse.json({ ok: true, shares });
});

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const shareId = new URL(req.url).searchParams.get("shareId") ?? "";
  await prisma.gmbReportShare.updateMany({ where: { id: shareId, workspaceId: api.workspaceId, clientId: client.id }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
