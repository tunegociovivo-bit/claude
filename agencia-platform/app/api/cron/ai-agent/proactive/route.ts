/**
 * Cron de proactividad de Sonia.
 *
 * Recorre todos los workspaces que tengan Sonia configurada Y
 * proactividad activada (settings.aiAgent.proactiveEnabled === true),
 * detecta tareas EN RIESGO según dos criterios y crea AiAgentRun
 * en PENDING para cada una. El cron normal /process se encargará
 * de ejecutarlos.
 *
 * CRITERIOS (configurables por workspace, defaults entre paréntesis):
 *   - PROACTIVE_DEADLINE: dueDate existe AND vence en próximas N horas
 *     (default 48h) AND status NOT in [DONE, ARCHIVED, columnas isDone].
 *   - PROACTIVE_STALE: status IN_PROGRESS AND updatedAt > N días ago
 *     (default 7 días).
 *
 * DEDUPE: para una misma task NO disparamos otro run proactivo si ya
 * lanzamos uno en las últimas 24h (sin importar su outcome — si el
 * humano lo ignoró, no insistimos cada hora).
 *
 * Llamar cada 15-60 min. Auth: CRON_SECRET. Sin secret → 503.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

type Cfg = {
  enabled: boolean;
  deadlineHours: number;
  staleDays: number;
  maxRunsPerCron: number;
};

function loadCfg(settings: any): Cfg | null {
  const cfg = settings?.aiAgent;
  if (!cfg?.userId || !cfg?.inboxProjectId) return null;
  const p = cfg.proactive ?? {};
  return {
    enabled: p.enabled === true,
    deadlineHours: Math.max(1, Math.min(Number(p.deadlineHours) || 48, 168)),
    staleDays: Math.max(1, Math.min(Number(p.staleDays) || 7, 60)),
    // Hard cap por workspace por ejecución del cron — evita que un
    // workspace con 500 tareas vencidas dispare 500 runs y queme tokens.
    maxRunsPerCron: Math.max(1, Math.min(Number(p.maxRunsPerCron) || 5, 25))
  };
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });
  }

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true, settings: true }
  });

  const results: any[] = [];
  for (const ws of workspaces) {
    const cfg = loadCfg(ws.settings);
    if (!cfg || !cfg.enabled) continue;

    const now = new Date();
    const deadlineCutoff = new Date(now.getTime() + cfg.deadlineHours * 60 * 60 * 1000);
    const staleCutoff = new Date(now.getTime() - cfg.staleDays * 24 * 60 * 60 * 1000);
    const dedupeCutoff = new Date(now.getTime() - DEDUPE_WINDOW_MS);

    // Candidatas: tareas del workspace que cumplen UNO de los dos criterios.
    // Excluímos las que están en DONE explícito.
    const candidates = await prisma.task.findMany({
      where: {
        workspaceId: ws.id,
        OR: [
          // PROACTIVE_DEADLINE: due próxima sin completar
          {
            dueDate: { gte: now, lte: deadlineCutoff },
            status: { notIn: ["DONE", "DONE_ARCHIVED"] },
            completedAt: null
          },
          // PROACTIVE_STALE: en marcha hace mucho sin moverse
          {
            status: "IN_PROGRESS",
            updatedAt: { lt: staleCutoff }
          }
        ]
      },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        updatedAt: true
      },
      take: 200 // hard cap defensivo antes del dedupe
    });

    // DEDUPE: descarta las que tienen un AiAgentRun creado en las
    // últimas 24h (cualquier trigger — manual, mention, proactivo).
    const recentRuns = await prisma.aiAgentRun.findMany({
      where: {
        workspaceId: ws.id,
        taskId: { in: candidates.map((c) => c.id) },
        createdAt: { gte: dedupeCutoff }
      },
      select: { taskId: true }
    });
    const recentSet = new Set(recentRuns.map((r) => r.taskId));

    const toLaunch = candidates.filter((c) => !recentSet.has(c.id)).slice(0, cfg.maxRunsPerCron);

    const launched: { taskId: string; trigger: string }[] = [];
    for (const t of toLaunch) {
      const isDeadline = t.dueDate && t.dueDate >= now && t.dueDate <= deadlineCutoff;
      const trigger: any = isDeadline ? "PROACTIVE_DEADLINE" : "PROACTIVE_STALE";
      const ctx = isDeadline
        ? `dueDate=${t.dueDate?.toISOString()} (en ${Math.round(((t.dueDate?.getTime() ?? 0) - now.getTime()) / (60 * 60 * 1000))}h), status=${t.status}`
        : `status=IN_PROGRESS desde hace ${Math.round((now.getTime() - t.updatedAt.getTime()) / (24 * 60 * 60 * 1000))} días sin updates`;
      try {
        await prisma.aiAgentRun.create({
          data: {
            workspaceId: ws.id,
            taskId: t.id,
            status: "PENDING",
            trigger,
            triggerContext: ctx
          }
        });
        launched.push({ taskId: t.id, trigger });
      } catch (e: any) {
        // No bloqueamos a otros workspaces si uno falla
        console.warn(`[proactive] failed for task ${t.id}:`, e?.message ?? e);
      }
    }

    results.push({
      workspaceId: ws.id,
      candidates: candidates.length,
      deduped: candidates.length - toLaunch.length,
      launched: launched.length,
      deadlineHours: cfg.deadlineHours,
      staleDays: cfg.staleDays
    });
  }

  return NextResponse.json({ ok: true, workspaces: results });
}

export const POST = GET;
