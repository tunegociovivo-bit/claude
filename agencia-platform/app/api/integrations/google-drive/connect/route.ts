import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { driveAuthorizeUrl, driveOAuthConfigurationIssue, signDriveState } from "@/lib/integrations/google-drive-oauth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  const base = process.env.NEXTAUTH_URL?.trim() || req.nextUrl.origin;
  if (!userId || !workspaceId) return NextResponse.redirect(`${base}/login`);
  const issue = driveOAuthConfigurationIssue();
  if (issue) {
    return NextResponse.redirect(`${base}/admin/seguridad?drive=oauth_missing_${issue}`);
  }
  try {
    return NextResponse.redirect(driveAuthorizeUrl(signDriveState({ userId, workspaceId, ts: Date.now() })));
  } catch (error) {
    console.error("[drive oauth connect]", error);
    return NextResponse.redirect(`${base}/admin/seguridad?drive=failed`);
  }
}
