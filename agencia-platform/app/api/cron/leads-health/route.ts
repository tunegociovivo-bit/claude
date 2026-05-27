/**
 * Cron health-check de WAHA para la cola de leads. Llamado cada ~5 min.
 *
 * Si la sesión WAHA lleva más de 30 minutos sin responder OK:
 *   1) Pone leads.sendPaused=true para evitar que la cola siga
 *      intentando envíos contra un servidor caído (saturaría reintentos).
 *   2) Crea Notification y push a todos los admins del workspace.
 *
 * Si vuelve a estar OK tras una caída, despausa automáticamente y
 * notifica el "recovery".
 *
 * Estado persistido en Workspace.settings.leads.health = {
 *   lastOkAt: ISO,
 *   lastDownAt: ISO,
 *   pausedByHealth: boolean
 * }
 *
 * Seguridad: header Authorization: Bearer ${CRON_SECRET}.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

const DOWN_THRESHOLD_MS = 30 * 60 * 1000;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    where: { settings: { not: undefined } as any },
    select: { id: true, settings: true }
  });

  const out: Array<{ workspaceId: string; status: string; action?: string }> = [];
  for (const ws of workspaces) {
    const s: any = ws.settings ?? {};
    const leads = s.leads ?? {};
    // Solo evaluamos workspaces que parecen tener leads configurados.
    if (!leads.wahaUrl && !leads.evolutionUrl) continue;

    let okNow = false;
    try {
      const { getWhatsappProvider, getWahaConfig } = await import("@/lib/leads/waha");
      const provider = await getWhatsappProvider(ws.id);
      if (provider === "evolution") {
        const { evoConnectionState } = await import("@/lib/leads/evolution");
        const st = await evoConnectionState(ws.id);
        okNow = !!st.reachable && st.state === "open";
      } else {
        const cfg = await getWahaConfig(ws.id);
        const resp = await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(cfg.session)}`, {
          headers: { "X-Api-Key": cfg.apiKey },
          signal: AbortSignal.timeout(7000)
        });
        if (resp.ok) {
          const data: any = await resp.json().catch(() => ({}));
          const status = data?.status ?? data?.engine?.state ?? null;
          okNow = status === "WORKING" || status === "CONNECTED";
        }
      }
    } catch {
      okNow = false;
    }

    const health = leads.health ?? { lastOkAt: null, lastDownAt: null, pausedByHealth: false };
    const now = new Date();
    let action: string | undefined;
    let wasDownLongEnough = false;
    if (okNow) {
      health.lastOkAt = now.toISOString();
      // Si estaba pausado por nosotros, despausamos y avisamos del recovery.
      if (health.pausedByHealth) {
        leads.sendPaused = false;
        health.pausedByHealth = false;
        action = "recovered";
        await notifyAdmins(ws.id, `✅ WAHA/Evolution recuperado. Cola de leads despausada.`);
      }
    } else {
      if (!health.lastDownAt) health.lastDownAt = now.toISOString();
      const downSince = new Date(health.lastDownAt).getTime();
      wasDownLongEnough = now.getTime() - downSince > DOWN_THRESHOLD_MS;
      if (wasDownLongEnough && !health.pausedByHealth) {
        leads.sendPaused = true;
        health.pausedByHealth = true;
        action = "paused";
        const downMin = Math.round((now.getTime() - downSince) / 60_000);
        await notifyAdmins(
          ws.id,
          `⚠️ WAHA/Evolution lleva ${downMin}min sin responder. He pausado la cola de leads automáticamente. Revisa la conexión en /admin/leads/settings.`
        );
      }
    }
    if (okNow) health.lastDownAt = null;
    leads.health = health;
    s.leads = leads;
    await prisma.workspace.update({ where: { id: ws.id }, data: { settings: s } });
    out.push({ workspaceId: ws.id, status: okNow ? "ok" : "down", action });
  }
  return NextResponse.json({ ok: true, items: out });
}

async function notifyAdmins(workspaceId: string, body: string): Promise<void> {
  try {
    const admins = await prisma.membership.findMany({
      where: { workspaceId, role: "ADMIN" },
      select: { userId: true }
    });
    if (admins.length === 0) return;
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.userId,
        type: "leads_health",
        body,
        link: "/admin/leads/settings"
      }))
    });
    const { sendPushToUser } = await import("@/lib/push/web-push");
    await Promise.all(
      admins.map((a) =>
        sendPushToUser(a.userId, {
          title: "Cola de leads",
          body,
          link: "/admin/leads/settings",
          tag: `leads-health-${workspaceId}`
        }).catch(() => {})
      )
    );
  } catch (e) {
    console.warn("[leads-health notify]:", (e as any)?.message ?? e);
  }
}
