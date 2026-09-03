import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { encryptSecret } from "@/lib/ai/crypto";
import { prisma } from "@/lib/db/prisma";
import { exchangeGoogleAdsCode, googleAdsAccountEmail, verifyGoogleAdsState } from "@/lib/integrations/google-ads-oauth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const base = process.env.NEXTAUTH_URL?.trim() || req.nextUrl.origin;
  const done = (result: string) => NextResponse.redirect(`${base}/facturacion/gestoria?googleAds=${result}`);
  if (req.nextUrl.searchParams.get("error")) return done("denied");
  const state = verifyGoogleAdsState(req.nextUrl.searchParams.get("state") || "");
  const code = req.nextUrl.searchParams.get("code");
  if (!state || !code || Date.now() - state.ts > 10 * 60_000) return done("invalid");
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.id !== state.userId || await getSessionWorkspaceId() !== state.workspaceId) return done("invalid_session");
  const membership = await prisma.membership.findFirst({ where: { userId: state.userId, workspaceId: state.workspaceId, role: "ADMIN" } });
  if (!membership) return done("forbidden");
  try {
    const tokens = await exchangeGoogleAdsCode(code);
    if (!tokens.refresh_token) return done("no_refresh");
    const actualEmail = await googleAdsAccountEmail(tokens.access_token);
    if (actualEmail !== state.accountEmail) return done("wrong_account");
    await prisma.googleAdsConnection.upsert({
      where: { workspaceId_accountEmail: { workspaceId: state.workspaceId, accountEmail: actualEmail } },
      create: { workspaceId: state.workspaceId, accountEmail: actualEmail, label: state.label, refreshTokenEnc: encryptSecret(tokens.refresh_token), customerId: state.managerId, loginCustomerId: state.managerId },
      update: { label: state.label, refreshTokenEnc: encryptSecret(tokens.refresh_token), customerId: state.managerId, loginCustomerId: state.managerId }
    });
    return done("connected");
  } catch (error) {
    console.error("[google ads oauth]", error);
    return done("failed");
  }
}
