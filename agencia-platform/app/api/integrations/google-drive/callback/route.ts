import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/ai/crypto";
import { ensureBackupFolder, exchangeDriveCode, googleAccountEmail, verifyDriveState } from "@/lib/integrations/google-drive-oauth";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const done = (value: string) => NextResponse.redirect(`${base}/admin/seguridad?drive=${value}`);
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
  const state = verifyDriveState(url.searchParams.get("state") ?? "");
  if (!code || !state || Date.now() - state.ts > 10 * 60_000) return done("invalid");
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as any)?.id as string | undefined;
  const sessionWorkspaceId = await getSessionWorkspaceId();
  if (!sessionUserId || sessionUserId !== state.userId || sessionWorkspaceId !== state.workspaceId) return done("invalid_session");
  const membership = await prisma.membership.findFirst({ where: { userId: state.userId, workspaceId: state.workspaceId, role: "ADMIN" } });
  if (!membership) return done("forbidden");
  try {
    const tokens = await exchangeDriveCode(code);
    if (!tokens.refresh_token) return done("no_refresh");
    const [folderId, accountEmail] = await Promise.all([ensureBackupFolder(tokens.access_token), googleAccountEmail(tokens.access_token)]);
    const ws = await prisma.workspace.findUnique({ where: { id: state.workspaceId } });
    const settings: any = ws?.settings ?? {};
    settings.integrations ??= {};
    settings.integrations.googleDrive = { ...(settings.integrations.googleDrive ?? {}), refreshTokenEncrypted: encryptSecret(tokens.refresh_token), accountEmail, folderId };
    delete settings.integrations.googleDrive.serviceAccountJsonEncrypted;
    await prisma.workspace.update({ where: { id: state.workspaceId }, data: { settings } });
    return done("connected");
  } catch (e) {
    console.error("[drive oauth]", e);
    return done("failed");
  }
}
