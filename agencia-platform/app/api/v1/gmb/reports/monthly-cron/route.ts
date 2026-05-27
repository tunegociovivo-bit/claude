/**
 * POST /api/v1/gmb/reports/monthly-cron  (CRON, protegido por secreto)
 *
 * Registra el rating mensual de cada ficha (GmbRatingHistory) y envía a cada
 * workspace un email resumen. Llamar 1 vez al mes con:
 *   x-cron-secret: $CRON_SECRET
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getGmbConfig } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const monthYear = new Date().toISOString().slice(0, 7);
  const clients = await prisma.gmbClient.findMany({ select: { id: true, name: true, workspaceId: true } });

  // Agrupar por workspace
  const byWs = new Map<string, Array<{ id: string; name: string }>>();
  for (const c of clients) {
    const arr = byWs.get(c.workspaceId) ?? [];
    arr.push({ id: c.id, name: c.name });
    byWs.set(c.workspaceId, arr);
  }

  let emails = 0;
  for (const [workspaceId, list] of byWs) {
    const rows: Array<{ name: string; avg: number; total: number; rate: number }> = [];
    for (const c of list) {
      const agg = await prisma.gmbReview.aggregate({
        where: { clientId: c.id },
        _avg: { rating: true },
        _count: true
      });
      const total = agg._count;
      const avg = Number((agg._avg.rating ?? 0).toFixed(1));
      const unreplied = await prisma.gmbReview.count({ where: { clientId: c.id, OR: [{ reviewReply: null }, { reviewReply: "" }] } });
      const rate = total ? Math.round(((total - unreplied) / total) * 100) : 0;
      await prisma.gmbRatingHistory.upsert({
        where: { clientId_monthYear: { clientId: c.id, monthYear } },
        create: { workspaceId, clientId: c.id, monthYear, avgRating: avg, reviewCount: total },
        update: { avgRating: avg, reviewCount: total }
      });
      rows.push({ name: c.name, avg, total, rate });
    }

    const cfg = await getGmbConfig(workspaceId);
    if (cfg.notifyEmail) {
      try {
        const { sendEmail, isEmailEnabled } = await import("@/lib/integrations/email");
        if (isEmailEnabled()) {
          const tr = rows
            .map((r) => `<tr><td style="padding:6px">${esc(r.name)}</td><td style="padding:6px;text-align:center">${r.avg}★</td><td style="padding:6px;text-align:center">${r.total}</td><td style="padding:6px;text-align:center">${r.rate}%</td></tr>`)
            .join("");
          await sendEmail({
            to: cfg.notifyEmail.split(",").map((x) => x.trim()).filter(Boolean),
            subject: `[GMB Hub] Informe mensual — ${monthYear}`,
            html: `<div style="font-family:Arial,sans-serif"><h2>Informe mensual GMB — ${monthYear}</h2>
<table style="border-collapse:collapse;width:100%"><thead><tr style="border-bottom:2px solid #ddd"><th style="padding:6px;text-align:left">Ficha</th><th style="padding:6px">Rating</th><th style="padding:6px">Reseñas</th><th style="padding:6px">Resp.</th></tr></thead><tbody>${tr}</tbody></table></div>`
          });
          emails++;
        }
      } catch {}
    }
  }
  return NextResponse.json({ ok: true, workspaces: byWs.size, emails, monthYear });
}
