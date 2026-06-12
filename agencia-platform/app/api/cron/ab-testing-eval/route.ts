/**
 * Cron de evaluación de A/B tests Meta Ads.
 *
 * Cada 6h:
 *  1. listPendingAbTests() devuelve los tests con evalAt < now
 *  2. Por cada uno, metaAdsEvaluateAbTest lee insights y marca
 *     el test como evaluated (V1 sin pause automático — requiere
 *     breakdown por adset que aún no expone metaAdsGetCampaignInsights)
 *  3. Postea comentario en la task asociada con resultados
 *
 * Seguridad: header Authorization: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { listPendingAbTests, metaAdsEvaluateAbTest } from "@/lib/meta/ab-testing";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authed(req: NextRequest): boolean {
  return cronAuthOk(req);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });
  }
  const pending = await listPendingAbTests();
  const summary: any[] = [];
  for (const p of pending) {
    try {
      const result = await metaAdsEvaluateAbTest({
        workspaceId: p.workspaceId,
        campaignId: p.campaignId
      });
      // Postear comentario en la task
      const ws = await prisma.workspace.findUnique({
        where: { id: p.workspaceId },
        select: { settings: true }
      });
      const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
      if (aiUserId && p.record.taskId) {
        const lines = [
          `📊 **A/B test evaluado — campaña ${p.campaignId}**`,
          ``,
          `Ganador: **${result.winnerLabel}**`,
          ``,
          `Resultados por variante:`,
          ...(result.resultsLog ?? []).map(
            (r: any) =>
              `  • **${r.label}** · ${r.leads.toFixed(0)} leads · ${r.spend.toFixed(2)}€ · CPL ${r.cpl.toFixed(2)}€`
          )
        ];
        await prisma.comment
          .create({
            data: {
              workspaceId: p.workspaceId,
              authorId: aiUserId,
              targetType: "TASK",
              targetId: p.record.taskId,
              body: lines.join("\n")
            }
          })
          .catch(() => {});
      }
      summary.push({
        workspaceId: p.workspaceId,
        campaignId: p.campaignId,
        winner: result.winnerLabel,
        ok: true
      });
    } catch (e: any) {
      summary.push({
        workspaceId: p.workspaceId,
        campaignId: p.campaignId,
        ok: false,
        error: String(e?.message ?? e).slice(0, 200)
      });
    }
  }
  return NextResponse.json({ ok: true, processed: summary.length, summary });
}
