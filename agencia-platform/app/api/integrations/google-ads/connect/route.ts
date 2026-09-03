import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { googleAdsAuthorizeUrl, googleAdsOAuthIssue, signGoogleAdsState } from "@/lib/integrations/google-ads-oauth";

export const dynamic = "force-dynamic";
const ACCOUNTS: Record<string, { managerId: string; label: string }> = {
  "tunegociovivo@gmail.com": { managerId: "7345969329", label: "Negocio Vivo" },
  "eroskifranquicias.marketing@gmail.com": { managerId: "5284702252", label: "Marketing Eroski NV" }
};

export async function GET(req: NextRequest) {
  const base = process.env.NEXTAUTH_URL?.trim() || req.nextUrl.origin;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) return NextResponse.redirect(`${base}/login`);
  const membership = await prisma.membership.findFirst({ where: { userId, workspaceId, role: "ADMIN" } });
  if (!membership) return NextResponse.redirect(`${base}/facturacion/gestoria?googleAds=forbidden`);
  const accountEmail = (req.nextUrl.searchParams.get("account") || "").toLowerCase();
  const account = ACCOUNTS[accountEmail];
  if (!account) return NextResponse.redirect(`${base}/facturacion/gestoria?googleAds=invalid_account`);
  const issue = googleAdsOAuthIssue();
  if (issue) return NextResponse.redirect(`${base}/facturacion/gestoria?googleAds=oauth_missing_${issue}`);
  const state = signGoogleAdsState({ userId, workspaceId, accountEmail, ...account, ts: Date.now() });
  return NextResponse.redirect(googleAdsAuthorizeUrl(state, accountEmail));
}
