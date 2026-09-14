import { prisma } from "@/lib/db/prisma";

export const GMB_COMPLIANCE_VERSION = "2026-09-13-v1";

/**
 * Estado efectivo del bucle GMB. La automatización usa deliberadamente la
 * cuenta Resend global: es la única vinculada al token/secret global del
 * webhook, así que mezclar una key de otro workspace haría perder eventos.
 */
export async function getGmbMultichannelSettings(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const root = (workspace?.settings as any) ?? {};
  const leads = root.leads ?? {};
  const envFrom = String(process.env.LEADS_EMAIL_FROM ?? "").trim();
  const envEmail = envFrom.match(/<([^>]+)>/)?.[1]?.trim() || (envFrom.includes("@") ? envFrom : "");
  const envName = envFrom.includes("<") ? envFrom.slice(0, envFrom.indexOf("<")).trim() : "";
  const resendReady = !!process.env.RESEND_API_KEY;
  const webhookReady = !!(process.env.RESEND_WEBHOOK_TOKEN && process.env.RESEND_WEBHOOK_SECRET);
  const hunterReady = !!(process.env.HUNTER_API_KEY || leads.hunterApiKeyEnc);
  const complianceReady = leads.gmbComplianceVersion === GMB_COMPLIANCE_VERSION && !!leads.gmbComplianceConfirmedAt;
  const replyTo = String(leads.gmbReplyTo ?? "").trim();

  return {
    enabled: leads.gmbMultichannelEnabled === true && resendReady && webhookReady && hunterReady && complianceReady && !!replyTo,
    resendReady,
    webhookReady,
    hunterReady,
    complianceReady,
    senderName: String(leads.gmbSenderName || envName || "Negocio Vivo").trim(),
    senderEmail: String(leads.gmbSenderEmail || envEmail || "info@ia.negociovivo.app").trim(),
    replyTo: replyTo || null,
    compliance: {
      version: leads.gmbComplianceVersion ?? null,
      confirmedAt: leads.gmbComplianceConfirmedAt ?? null,
      confirmedBy: leads.gmbComplianceConfirmedBy ?? null
    }
  };
}
