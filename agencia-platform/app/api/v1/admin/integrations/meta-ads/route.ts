/**
 * GET  → estado: si hay MetaConnection y adAccountId configurado
 * PUT  → body: { adAccountId: string }  guarda el adAccountId al
 *        workspace.settings.integrations.metaAds.adAccountId
 *
 * El access_token vive en MetaConnection (gestionado por el flow
 * OAuth de Meta que ya existe en la plataforma).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { metaAdsListAdAccounts } from "@/lib/integrations/meta-ads";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const conn = await prisma.metaConnection.findFirst({ where: { workspaceId: api.workspaceId } });
  const adAccountId = (ws?.settings as any)?.integrations?.metaAds?.adAccountId ?? null;
  let accounts: any[] = [];
  if (conn) {
    try {
      accounts = await metaAdsListAdAccounts(api.workspaceId);
    } catch (e: any) {
      return NextResponse.json({
        configured: false,
        adAccountId,
        connection: { ok: false, error: String(e?.message ?? e) }
      });
    }
  }
  return NextResponse.json({
    configured: !!(conn && adAccountId),
    hasConnection: !!conn,
    adAccountId,
    availableAccounts: accounts
  });
});

const putSchema = z.object({ adAccountId: z.string().min(3).max(40) });

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.metaAds = { adAccountId: parsed.data.adAccountId.trim() };
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});
