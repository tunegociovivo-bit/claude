/**
 * Cron diario: Sonia revisa todos los clientes activos del workspace
 * y crea tasks proactivas si detecta señales (reseñas negativas
 * nuevas, caídas de tráfico, sin publicar en 14d, etc).
 *
 * Bearer INTERNAL_CRON_TOKEN. Programar 1x al día por la mañana
 * (cron GitHub Actions: "0 8 * * *").
 *
 * Procesa TODOS los workspaces — itera con un loop simple, no es
 * costoso porque cada cliente hace 2-3 API calls.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  detectProactiveSignals,
  turnSignalsIntoTasks
} from "@/lib/ai/nv-ia/proactive-insights";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: { code: "cron_disabled" } },
      { status: 503 }
    );
  }
  if (token !== expected) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, settings: true }
  });

  const results: any[] = [];
  for (const ws of workspaces) {
    const aiCfg = (ws.settings as any)?.aiAgent;
    if (!aiCfg?.inboxProjectId) {
      results.push({ workspaceId: ws.id, skipped: "sin aiAgent.inboxProjectId" });
      continue;
    }
    // Solo si el workspace tiene proactiveInsights habilitado (opt-in)
    const enabled = !!aiCfg?.proactiveInsightsEnabled;
    if (!enabled) {
      results.push({ workspaceId: ws.id, skipped: "proactiveInsightsEnabled=false" });
      continue;
    }
    try {
      const signals = await detectProactiveSignals({ workspaceId: ws.id });
      const { created, deduplicated } = await turnSignalsIntoTasks({
        workspaceId: ws.id,
        inboxProjectId: aiCfg.inboxProjectId,
        signals
      });
      results.push({
        workspaceId: ws.id,
        signalsDetected: signals.length,
        tasksCreated: created,
        tasksDeduplicated: deduplicated
      });
    } catch (e: any) {
      results.push({ workspaceId: ws.id, error: e?.message ?? String(e) });
    }
  }

  return NextResponse.json({ ok: true, results });
}

export const GET = POST;
