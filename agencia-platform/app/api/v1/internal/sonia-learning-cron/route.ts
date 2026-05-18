/**
 * Cron: extrae lecciones del feedback humano en interacciones recientes.
 *
 * Recorre todos los workspaces con aiAgent.autoLearningEnabled = true
 * y llama a extractLessonsForWorkspace. Cada workspace procesa hasta
 * 30 candidatos por pasada (~30¢ Haiku máximo).
 *
 * Frecuencia recomendada: 1x al día. Bearer INTERNAL_CRON_TOKEN.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { extractLessonsForWorkspace } from "@/lib/ai/nv-ia/auto-learning";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: { code: "cron_disabled" } }, { status: 503 });
  }
  if (token !== expected) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, settings: true }
  });

  const results: any[] = [];
  for (const ws of workspaces) {
    const enabled = !!(ws.settings as any)?.aiAgent?.autoLearningEnabled;
    if (!enabled) {
      results.push({ workspaceId: ws.id, skipped: "autoLearningEnabled=false" });
      continue;
    }
    try {
      const r = await extractLessonsForWorkspace({
        workspaceId: ws.id,
        daysBack: 7,
        maxCandidates: 30
      });
      results.push({ workspaceId: ws.id, ...r });
    } catch (e: any) {
      results.push({ workspaceId: ws.id, error: e?.message ?? String(e) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
export const GET = POST;
