import { prisma } from "@/lib/db/prisma";
import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";

export const BANK_AGENT_OFFLINE_MS = 3 * 60 * 1000;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function isBankAgentOffline(lastHeartbeatAt: Date | null, now = new Date()) {
  return Boolean(lastHeartbeatAt && now.getTime() - lastHeartbeatAt.getTime() >= BANK_AGENT_OFFLINE_MS);
}

export async function monitorOfflineBankAgents(now = new Date()) {
  const cutoff = new Date(now.getTime() - BANK_AGENT_OFFLINE_MS);
  const agents = await prisma.bankAgent.findMany({
    where: { status: "ACTIVE", lastHeartbeatAt: { not: null, lte: cutoff } },
    select: { id: true, workspaceId: true, name: true, lastHeartbeatAt: true }
  });
  let notified = 0;
  for (const agent of agents) {
    if (!agent.lastHeartbeatAt) continue;
    const link = `/facturacion/remesas?agent=${encodeURIComponent(agent.id)}`;
    const admins = await prisma.membership.findMany({
      where: { workspaceId: agent.workspaceId, role: "ADMIN" },
      select: { userId: true }
    });
    const already = admins.length ? await prisma.notification.findFirst({
      where: {
        userId: { in: admins.map((admin) => admin.userId) },
        type: "bank_agent_offline",
        link,
        createdAt: { gte: agent.lastHeartbeatAt }
      },
      select: { id: true }
    }) : null;
    if (already) continue;

    const body = `El agente bancario ${agent.name} está desconectado desde ${agent.lastHeartbeatAt.toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}. El reinicio automático seguirá intentándolo.`;
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map((admin) => ({ userId: admin.userId, type: "bank_agent_offline", body, link }))
      });
    }
    if (isEmailEnabled()) {
      const to = process.env.SEPA_APPROVAL_EMAIL || "info@negociovivo.com";
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://hub.negociovivo.app").replace(/\/$/, "");
      await sendEmail({
        to,
        workspaceId: agent.workspaceId,
        subject: `⚠️ Agente bancario desconectado · ${agent.name}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.5"><p>${escapeHtml(body)}</p><p><a href="${baseUrl}${link}">Revisar agente y trabajos en cola</a></p><p style="font-size:12px;color:#666">Se enviará un único aviso durante esta caída. Si se recupera y vuelve a caer, recibirás otro.</p></div>`,
        text: `${body}\nRevisar: ${baseUrl}${link}`
      });
    }
    notified++;
  }
  return { checked: agents.length, notified };
}
