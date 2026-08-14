import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { driveAuthorizeUrl, signDriveState } from "@/lib/integrations/google-drive-oauth";

export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  if (!userId || !workspaceId) return NextResponse.redirect(`${base}/login`);
  return NextResponse.redirect(driveAuthorizeUrl(signDriveState({ userId, workspaceId, ts: Date.now() })));
}
