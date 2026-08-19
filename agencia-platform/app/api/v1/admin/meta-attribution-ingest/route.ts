import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const GET = withApi({ rate: "admin" }, async (req, { api }) => {
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId || !z.string().regex(/^act_\d+$/).safeParse(accountId).success) throw new ApiError(400, "invalid_account", "Cuenta no válida");
  const profile = await prisma.metaClientProfile.findUnique({ where: { workspaceId_adAccountId: { workspaceId: api.workspaceId, adAccountId: accountId } }, select: { webhookToken: true } });
  if (!profile) throw new ApiError(404, "profile_required", "Guarda primero los objetivos y la memoria del cliente");
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  return NextResponse.json({ url: `${origin}/api/v1/meta-attribution/ingest/${profile.webhookToken}`, method: "POST" });
});
