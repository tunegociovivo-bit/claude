import "server-only";
import { prisma } from "@/lib/prisma";
import { getWorkspaceSettings } from "@/lib/settings";
import { getConnectionState } from "@/lib/waha-connection";
import { sendOpsEmail } from "@/lib/notify-email";
import { sendOperationalWhatsapp } from "@/lib/waha";
import { normalizeAlertEmail, normalizeAlertPhone, shouldSendUrgentAlert } from "@/lib/urgent-alerts";

const LABELS: Record<string, string> = {
  WHATSAPP_DISCONNECTED: "WhatsApp se ha desvinculado o está detenido",
  WHATSAPP_FAILED: "La conexión de WhatsApp está en estado de error",
  CRM_MESSAGE_ERROR: "El CRM no pudo procesar o responder un mensaje",
};

export async function notifyWorkspaceUrgentAlert(workspaceId: string, code: string, detail = "") {
  const [workspace, settings, state] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    getWorkspaceSettings(workspaceId),
    prisma.urgentAlertState.findUnique({ where: { workspaceId } }),
  ]);
  const alerts = settings.urgentAlerts;
  if (!alerts.enabled) return { sent: false, reason: "disabled" };
  const email = normalizeAlertEmail(alerts.email);
  const phone = normalizeAlertPhone(alerts.phone, settings.whatsapp.countryCode);
  if (!email && !phone) return { sent: false, reason: "no-destination" };
  const now = new Date();
  if (!shouldSendUrgentAlert({ lastCode: state?.lastCode ?? null, lastSentAt: state?.lastSentAt ?? null, code, now, reminderHours: state?.lastError ? 0.25 : 12 })) {
    return { sent: false, reason: "duplicate" };
  }
  const title = LABELS[code] || "El CRM ha detectado un error";
  const message = `ALERTA URGENTE CRM Ventas — ${workspace?.name || "Cliente"}: ${title}.${detail ? ` ${detail}` : ""} Revisa Ajustes en app.negociovivo.com.`;
  const [emailResult, whatsappResult] = await Promise.allSettled([
    email ? sendOpsEmail({ to: email, subject: `Alerta urgente: ${workspace?.name || "CRM Ventas"}`, rows: [["Incidencia", title], ["Detalle", detail || "Sin detalle adicional"], ["Fecha", now.toISOString()]], actionUrl: "https://app.negociovivo.com/ajustes", actionLabel: "Revisar CRM" }) : Promise.resolve({ ok: false as const, error: "EMAIL_EMPTY" }),
    phone ? sendOperationalWhatsapp({ workspaceId, to: phone, text: message }) : Promise.reject(new Error("WHATSAPP_EMPTY")),
  ] as const);
  const errors: string[] = [];
  if (emailResult.status === "rejected") errors.push(String(emailResult.reason?.message || emailResult.reason));
  else if (!emailResult.value.ok) errors.push(emailResult.value.error);
  if (whatsappResult.status === "rejected") errors.push(String(whatsappResult.reason?.message || whatsappResult.reason));
  await prisma.urgentAlertState.upsert({
    where: { workspaceId },
    update: { lastCode: code, lastSentAt: now, lastError: errors.join(", ") || null },
    create: { workspaceId, lastCode: code, lastSentAt: now, lastError: errors.join(", ") || null },
  });
  return { sent: true, errors };
}

export async function monitorUrgentAlerts() {
  const workspaces = await prisma.workspace.findMany({ where: { isBlocked: false }, select: { id: true } });
  for (const workspace of workspaces) {
    try {
      const connection = await getConnectionState(workspace.id);
      if (["FAILED", "STOPPED"].includes(connection.status)) {
        await notifyWorkspaceUrgentAlert(workspace.id, connection.status === "FAILED" ? "WHATSAPP_FAILED" : "WHATSAPP_DISCONNECTED", `Estado detectado: ${connection.status}`);
      } else if (connection.status === "WORKING") {
        await prisma.urgentAlertState.updateMany({ where: { workspaceId: workspace.id, lastCode: { startsWith: "WHATSAPP_" } }, data: { lastCode: null, lastError: null } });
      }
    } catch (error) {
      console.error(`[urgent-alerts] health check failed for ${workspace.id}:`, (error as Error)?.message);
    }
  }
}
