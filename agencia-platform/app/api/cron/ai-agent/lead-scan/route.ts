/**
 * Cron Lead Opportunity Scan (Fase 35).
 *
 * Recorre Lead activos del workspace (de lib/leads) y detecta señales
 * de oportunidad: leads que respondieron pero no cerraron en N días,
 * leads en estado "qualified" sin actividad reciente, etc.
 *
 * Para cada uno crea AiAgentRun(LEAD_OPPORTUNITY). Sonia investiga
 * con web_search (info pública de la empresa) y propone draft de
 * acercamiento personalizado.
 *
 * Llamar diariamente. Auth: CRON_SECRET. Opt-in en
 * settings.aiAgent.leadScan.enabled.
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

const DEDUPE_DAYS = 7;
const STALE_DAYS_DEFAULT = 14;

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });

  const workspaces = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  const dedupeCutoff = new Date(Date.now() - DEDUPE_DAYS * 24 * 60 * 60 * 1000);
  const results: any[] = [];

  for (const ws of workspaces) {
    const aiCfg = (ws.settings as any)?.aiAgent;
    if (!aiCfg?.inboxProjectId) continue;
    if (aiCfg?.leadScan?.enabled !== true) continue;
    const staleDays = Number(aiCfg?.leadScan?.staleDays) || STALE_DAYS_DEFAULT;
    const staleCutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    // Leads "respondieron" o "qualified" sin actividad reciente
    const opportunities = await prisma.lead.findMany({
      where: {
        workspaceId: ws.id,
        contactStatus: { in: ["responded", "qualified"] },
        updatedAt: { lt: staleCutoff }
      },
      take: 20,
      select: { id: true, name: true, phone: true, contactStatus: true }
    }).catch(() => []);

    if (opportunities.length === 0) continue;

    // Dedupe: leads ya con run en últimos 7d
    const recentRuns = await prisma.aiAgentRun.findMany({
      where: {
        workspaceId: ws.id,
        trigger: "LEAD_OPPORTUNITY",
        createdAt: { gte: dedupeCutoff }
      },
      select: { triggerContext: true }
    });
    const recentLeadNames = new Set(
      recentRuns.map((r) => (r.triggerContext ?? "").match(/lead:([\w-]+)/)?.[1]).filter(Boolean)
    );

    let launched = 0;
    for (const lead of opportunities) {
      if (recentLeadNames.has(lead.id)) continue;
      if (launched >= 5) break; // cap por workspace por cron run

      const task = await prisma.task.create({
        data: {
          workspaceId: ws.id,
          projectId: aiCfg.inboxProjectId,
          title: `💡 Oportunidad — ${lead.name ?? lead.phone ?? "lead"}`,
          description:
            `Lead detectado por el cron de oportunidades.\n\n` +
            `- Empresa: ${lead.name ?? "(?)"}\n` +
            `- Estado: ${lead.contactStatus}\n` +
            `- Contacto: ${lead.phone ?? "(?)"}\n` +
            `- Sin actividad desde hace ${staleDays}+ días\n\n` +
            `Investiga si sigue siendo buena oportunidad y propón acercamiento.`,
          status: "TODO",
          priority: "MEDIUM"
        }
      });
      await prisma.aiAgentRun.create({
        data: {
          workspaceId: ws.id,
          taskId: task.id,
          status: "PENDING",
          trigger: "LEAD_OPPORTUNITY",
          triggerContext: `lead:${lead.id} business:${lead.name ?? "?"} status:${lead.contactStatus}`

        }
      });
      launched++;
    }
    results.push({ workspaceId: ws.id, launched });
  }

  return NextResponse.json({ ok: true, workspaces: results });
}

export const POST = GET;
