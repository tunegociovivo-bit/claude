/**
 * Avisos del escudo de reputación: alerta en el hub (GmbAlert) + email y WhatsApp opcionales.
 * Las alertas se crean sin clientId para que la auto-resolución del cron de alertas no las cierre.
 */
import { prisma } from "@/lib/db/prisma";

export type ShieldAlert = {
  type: "review_attack" | "suspicious_review" | "known_profile" | "competitor_spike" | "review_removed" | "review_appeal_due";
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  dedupKey: string;
  data?: Record<string, unknown>;
};

/** Crea la alerta si no hay otra abierta con la misma clave. Devuelve true si es nueva. */
export async function raiseAlert(workspaceId: string, a: ShieldAlert): Promise<boolean> {
  const open = await prisma.gmbAlert.findFirst({ where: { workspaceId, dedupKey: a.dedupKey, status: { in: ["open", "ack"] } }, select: { id: true } });
  if (open) return false;
  await prisma.gmbAlert.create({
    data: {
      workspaceId,
      clientId: null,
      type: a.type,
      severity: a.severity,
      title: a.title.slice(0, 250),
      body: a.body.slice(0, 4000),
      dedupKey: a.dedupKey.slice(0, 250),
      deepLink: a.type === "competitor_spike" || a.type === "review_attack" ? "/gmb-hub?view=resenas-falsas&sub=vigilancia" : "/gmb-hub?view=resenas-falsas&sub=retiradas",
      data: (a.data ?? null) as any,
      status: "open"
    }
  });
  return true;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** Email + WhatsApp con las alertas nuevas (sólo aviso/crítico). Nunca lanza. */
export async function notifyChannels(workspaceId: string, target: { name: string; emails: string; whatsapp: string }, alerts: ShieldAlert[]) {
  const relevant = alerts.filter((a) => a.severity !== "info" || a.type === "review_removed");
  if (!relevant.length) return;
  const emails = target.emails.split(/[,;\s]+/).map((e) => e.trim()).filter((e) => /@/.test(e));
  const icon = (a: ShieldAlert) => (a.severity === "critical" ? "🔴" : a.type === "review_removed" ? "✅" : "🟠");
  const subject = `${relevant.some((a) => a.severity === "critical") ? "🔴 " : ""}Escudo de reputación · ${target.name}: ${relevant.length} aviso(s)`;
  if (emails.length) {
    try {
      const { sendEmail } = await import("@/lib/integrations/email");
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#16160F">
<h2 style="margin:0 0 12px">Escudo de reputación · ${esc(target.name)}</h2>
${relevant.map((a) => `<div style="border-left:3px solid ${a.severity === "critical" ? "#B3261E" : a.type === "review_removed" ? "#2E7D32" : "#C9962E"};padding:6px 10px;margin:0 0 10px;background:#F7F2E7"><b>${esc(a.title)}</b><br>${esc(a.body).replace(/\n/g, "<br>")}</div>`).join("")}
<p style="color:#6B665A;font-size:12px">Revisa los detalles y las denuncias preparadas en GMB Hub → Reseñas falsas.</p></div>`;
      await sendEmail({ workspaceId, to: emails, subject, html, text: relevant.map((a) => `${a.title}\n${a.body}`).join("\n\n") });
    } catch (e) {
      console.warn("[escudo] email", (e as Error).message);
    }
  }
  if (target.whatsapp.trim()) {
    try {
      const { sendText, normalizePhone } = await import("@/lib/leads/waha");
      const phone = normalizePhone(target.whatsapp);
      if (phone) {
        const text = [`*Escudo de reputación · ${target.name}*`, ...relevant.slice(0, 6).map((a) => `${icon(a)} *${a.title}*\n${a.body.slice(0, 400)}`)].join("\n\n");
        await sendText({ workspaceId, phoneNormalized: phone, text });
      }
    } catch (e) {
      console.warn("[escudo] whatsapp", (e as Error).message);
    }
  }
}
