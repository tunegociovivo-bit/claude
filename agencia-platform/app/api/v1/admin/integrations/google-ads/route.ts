/**
 * GET/PUT/DELETE Google Ads connection.
 * body PUT: { refreshToken, customerId, loginCustomerId? }
 *
 * Cómo obtener refreshToken: el admin pasa por el flow OAuth de
 * Google Ads (cliente OAuth con scope adwords). Más limpio sería
 * un endpoint /api/auth/google-ads/start que abre consent → callback
 * — para Fase 52-lite, el admin lo obtiene fuera (con oauth2l o el
 * playground) y lo pega aquí. El refresh_token se cifra al guardar.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { encryptSecret } from "@/lib/ai/crypto";
import { gadsTest } from "@/lib/integrations/google-ads";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const conn = await prisma.googleAdsConnection.findUnique({
    where: { workspaceId: api.workspaceId }
  });
  if (!conn) return NextResponse.json({ configured: false });
  try {
    const test = await gadsTest(api.workspaceId);
    return NextResponse.json({
      configured: true,
      customerId: conn.customerId,
      loginCustomerId: conn.loginCustomerId,
      test
    });
  } catch (e: any) {
    return NextResponse.json({
      configured: true,
      customerId: conn.customerId,
      loginCustomerId: conn.loginCustomerId,
      test: { ok: false, error: String(e?.message ?? e) }
    });
  }
});

const putSchema = z.object({
  refreshToken: z.string().min(10).max(500),
  customerId: z.string().regex(/^\d+$/, "customerId solo dígitos, sin guiones"),
  loginCustomerId: z.string().regex(/^\d+$/).optional()
});

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  await prisma.googleAdsConnection.upsert({
    where: { workspaceId: api.workspaceId },
    create: {
      workspaceId: api.workspaceId,
      refreshTokenEnc: encryptSecret(parsed.data.refreshToken.trim()),
      customerId: parsed.data.customerId,
      loginCustomerId: parsed.data.loginCustomerId ?? null
    },
    update: {
      refreshTokenEnc: encryptSecret(parsed.data.refreshToken.trim()),
      customerId: parsed.data.customerId,
      loginCustomerId: parsed.data.loginCustomerId ?? null
    }
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  await prisma.googleAdsConnection.deleteMany({ where: { workspaceId: api.workspaceId } });
  return NextResponse.json({ ok: true });
});
