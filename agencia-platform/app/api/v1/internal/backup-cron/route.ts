/**
 * Cron interno de backup diario.
 *
 * A diferencia de /api/v1/admin/backups (que hace backup del workspace del
 * usuario autenticado y pasa por withApi/authenticate), este endpoint:
 *   - Valida `Authorization: Bearer <INTERNAL_CRON_TOKEN>` DIRECTAMENTE (igual
 *     que el resto de crons internos), sin withApi.
 *   - Recorre TODOS los workspaces y hace backup de cada uno (best-effort:
 *     si uno falla, sigue con los demás).
 *
 * Lo llama .github/workflows/backup-daily.yml.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { runWorkspaceBackup } from "@/lib/backup/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // varios workspaces pueden tardar

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json(
      { error: { code: "cron_disabled", message: "INTERNAL_CRON_TOKEN no configurado" } },
      { status: 500 }
    );
  }
  if (token !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Token inválido" } },
      { status: 401 }
    );
  }

  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const results: Array<{ workspaceId: string; ok: boolean; sizeBytes?: number; runId?: string | null; error?: string }> = [];
  let completed = 0;
  let failed = 0;

  for (const ws of workspaces) {
    try {
      const r = await runWorkspaceBackup(ws.id, "cron");
      results.push({ workspaceId: ws.id, ok: true, sizeBytes: r.sizeBytes, runId: r.runId });
      completed++;
    } catch (e: any) {
      results.push({ workspaceId: ws.id, ok: false, error: String(e?.message ?? e).slice(0, 200) });
      failed++;
    }
  }

  return NextResponse.json({ ok: true, workspaces: workspaces.length, completed, failed, results });
}
