/**
 * Cron interno de backup a Google Drive. Pensado para llamarse 1 vez al
 * día (por ej. a las 03:00 UTC desde GitHub Actions).
 *
 * Itera todos los workspaces que tengan Drive configurado y dispara los
 * backups que tocan ese día (daily siempre; weekly si lunes; monthly si
 * día 1).
 *
 * Protegido por header Authorization: Bearer INTERNAL_CRON_TOKEN.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { runDriveBackup, whichBackupsToday } from "@/lib/backup/drive-rotation";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN ?? "";
  if (!expected || token !== expected) {
    return NextResponse.json({ error: { code: "bad_token", message: "Token inválido" } }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true, settings: true }
  });

  const kinds = whichBackupsToday();
  const report: any[] = [];

  for (const ws of workspaces) {
    const gd: any = (ws.settings as any)?.integrations?.googleDrive ?? {};
    if (!gd.serviceAccountJsonEncrypted || !gd.folderId) {
      report.push({ workspaceId: ws.id, skipped: "drive_not_configured" });
      continue;
    }
    try {
      const r = await runDriveBackup({ workspaceId: ws.id, kinds });
      report.push({ workspaceId: ws.id, results: r.results });
    } catch (e: any) {
      report.push({ workspaceId: ws.id, error: e?.message ?? String(e) });
    }
  }

  return NextResponse.json({ ok: true, date: new Date().toISOString(), kinds, report });
}
