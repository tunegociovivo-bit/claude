import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/ai/crypto";
import { ensureBackupFolder, exchangeDriveCode, googleAccountEmail, verifyDriveState } from "@/lib/integrations/google-drive-oauth";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const base = process.env.NEXTAUTH_URL?.trim() || req.nextUrl.origin;
  let leadPurpose = false;
  let jobsPurpose = false;
  const done = (value: string) => NextResponse.redirect(jobsPurpose ? `${base}/admin/leads?tab=jobs-review&jobsInbox=${value}` : leadPurpose ? `${base}/meta?leadDrive=${value}` : `${base}/admin/seguridad?drive=${value}`);
  const url = new URL(req.url);
  const state = verifyDriveState(url.searchParams.get("state") ?? "");
  leadPurpose = state?.purpose === "lead_documents";
  jobsPurpose = state?.purpose === "jobs_inbox";
  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
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
    const accountEmail = await googleAccountEmail(tokens.access_token);
    const ws = await prisma.workspace.findUnique({ where: { id: state.workspaceId } });
    const settings: any = ws?.settings ?? {};
    settings.integrations ??= {};
    if (jobsPurpose) {
      settings.integrations.googleJobsInbox = { refreshTokenEncrypted: encryptSecret(tokens.refresh_token), accountEmail, connectedAt: new Date().toISOString() };
      settings.leads ??= {};
      settings.leads.jobsInboxUser = accountEmail;
      settings.leads.jobsInboxEnabled = true;
      delete settings.leads.jobsInboxLastError;
    } else if (leadPurpose) {
      if (accountEmail.toLowerCase() !== "tunegociovivo@gmail.com") return done("wrong_account");
      settings.integrations.googleLeadDocuments = { refreshTokenEncrypted: encryptSecret(tokens.refresh_token), accountEmail, connectedAt: new Date().toISOString() };
    } else {
      const folderId = await ensureBackupFolder(tokens.access_token);
      settings.integrations.googleDrive = { ...(settings.integrations.googleDrive ?? {}), refreshTokenEncrypted: encryptSecret(tokens.refresh_token), accountEmail, folderId };
      delete settings.integrations.googleDrive.serviceAccountJsonEncrypted;
    }
    await prisma.workspace.update({ where: { id: state.workspaceId }, data: { settings } });
    return done("connected");
  } catch (e) {
    console.error("[drive oauth]", e);
    return done("failed");
  }
}
