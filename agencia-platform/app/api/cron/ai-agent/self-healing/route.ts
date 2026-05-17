/**
 * Cron Self-Healing (Fase 44).
 *
 * Sonia analiza sus propios fallos: agrupa runs FAILED de los últimos
 * 7d por patrón de error (primeros 80 chars del error). Si encuentra
 * un patrón con >=3 ocurrencias, crea una task de auto-diagnóstico
 * con AiAgentRun(SELF_HEALING) — Sonia investiga el patrón y propone:
 *   - una propose_new_tool si falta capacidad
 *   - un update_workspace_memory con un workaround si es prompt
 *   - escalar al admin si requiere fix de código
 *
 * Llamar semanal. Auth: CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dedupeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const workspaces = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  const results: any[] = [];

  for (const ws of workspaces) {
    const aiCfg = (ws.settings as any)?.aiAgent;
    if (!aiCfg?.inboxProjectId) continue;
    if (aiCfg?.selfHealing?.enabled !== true) continue;

    const failed = await prisma.aiAgentRun.findMany({
      where: {
        workspaceId: ws.id,
        status: { in: ["FAILED", "REQUIRES_HUMAN"] },
        createdAt: { gte: since },
        error: { not: null }
      },
      select: { error: true, trigger: true }
    });
    if (failed.length === 0) continue;

    // Agrupar por primeros 80 chars del error (normalizado)
    const groups: Record<string, { count: number; sample: string; triggers: Set<string> }> = {};
    for (const r of failed) {
      const key = (r.error ?? "").trim().slice(0, 80).toLowerCase().replace(/\s+/g, " ");
      if (!key) continue;
      if (!groups[key]) groups[key] = { count: 0, sample: r.error ?? "", triggers: new Set() };
      groups[key].count++;
      groups[key].triggers.add(r.trigger);
    }

    const patterns = Object.entries(groups)
      .filter(([, g]) => g.count >= 3)
      .sort((a, b) => b[1].count - a[1].count);

    if (patterns.length === 0) continue;

    // Dedupe: una SELF_HEALING task en últimos 30d ya cubre estos
    // patrones; no creamos otra para no spamear.
    const recent = await prisma.aiAgentRun.findFirst({
      where: {
        workspaceId: ws.id,
        trigger: "SELF_HEALING",
        createdAt: { gte: dedupeSince }
      }
    });
    if (recent) {
      results.push({ workspaceId: ws.id, skipped: "recent_self_healing_exists" });
      continue;
    }

    const description =
      `Auto-diagnóstico de Sonia — patrones de fallo recurrentes en los últimos 7 días.\n\n` +
      patterns
        .map(
          ([, g], i) =>
            `${i + 1}. ${g.count} fallos | triggers: ${[...g.triggers].join(", ")}\n   Error: ${g.sample.slice(0, 200)}`
        )
        .join("\n\n") +
      `\n\n` +
      `INSTRUCCIÓN: investiga estos patrones. Para cada uno decide:\n` +
      `- Si falta una capacidad: propose_new_tool con el caso de uso.\n` +
      `- Si es prompt confuso o memoria insuficiente: update_workspace_memory con un workaround.\n` +
      `- Si es bug de código: notify_user al admin con add_comment detallando.\n` +
      `Cierra con mark_complete una vez analizado todo.`;

    const task = await prisma.task.create({
      data: {
        workspaceId: ws.id,
        projectId: aiCfg.inboxProjectId,
        title: `🔧 Auto-diagnóstico — ${patterns.length} patrones de fallo recurrentes`,
        description,
        status: "TODO",
        priority: "MEDIUM"
      }
    });
    await prisma.aiAgentRun.create({
      data: {
        workspaceId: ws.id,
        taskId: task.id,
        status: "PENDING",
        trigger: "SELF_HEALING",
        triggerContext: `Patrones de fallo recurrentes: ${patterns.length} (top: "${patterns[0][1].sample.slice(0, 60)}")`
      }
    });
    results.push({ workspaceId: ws.id, patterns: patterns.length, taskId: task.id });
  }

  return NextResponse.json({ ok: true, results });
}

export const POST = GET;
