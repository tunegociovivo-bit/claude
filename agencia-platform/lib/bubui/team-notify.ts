/**
 * Notificaciones al EQUIPO de Bubui (admin) — email + WhatsApp.
 *
 * Destinos configurables desde el panel admin (BubuiSetting "notify_config"):
 *   { emails: string[], whatsapp: string | null }
 *
 * Defaults: info@negociovivo.com y WhatsApp 680167881 (se pueden cambiar o
 * ampliar sin deploy). El email usa el transporte del Hub (Resend); el
 * WhatsApp sale por el proveedor activo del workspace (WAHA/Evolution, el
 * mismo de NV Leads Pro). Todo best-effort: si un canal falla, no rompe el
 * flujo que notifica.
 */
import { prisma } from "@/lib/db/prisma";
import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";

const KEY = "notify_config";

export type TeamNotifyConfig = { emails: string[]; whatsapp: string | null };

const DEFAULTS: TeamNotifyConfig = {
  emails: ["info@negociovivo.com"],
  whatsapp: "680167881"
};

export async function getTeamNotifyConfig(): Promise<TeamNotifyConfig> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: KEY } });
  if (!row) {
    // Compat: si existe BUBUI_TEAM_EMAIL, se añade a los defaults.
    const env = process.env.BUBUI_TEAM_EMAIL?.trim();
    return {
      emails: env && !DEFAULTS.emails.includes(env) ? [...DEFAULTS.emails, env] : [...DEFAULTS.emails],
      whatsapp: DEFAULTS.whatsapp
    };
  }
  try {
    const v = JSON.parse(row.value);
    const emails = Array.isArray(v?.emails)
      ? v.emails.map((e: any) => String(e).trim()).filter((e: string) => /.+@.+\..+/.test(e))
      : [];
    return {
      emails: emails.length > 0 ? emails : [...DEFAULTS.emails],
      whatsapp: typeof v?.whatsapp === "string" && v.whatsapp.trim() ? v.whatsapp.trim() : null
    };
  } catch {
    return { ...DEFAULTS, emails: [...DEFAULTS.emails] };
  }
}

export async function setTeamNotifyConfig(cfg: TeamNotifyConfig): Promise<TeamNotifyConfig> {
  const clean: TeamNotifyConfig = {
    emails: cfg.emails.map((e) => e.trim()).filter((e) => /.+@.+\..+/.test(e)),
    whatsapp: cfg.whatsapp?.trim() || null
  };
  await prisma.bubuiSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(clean) },
    update: { value: JSON.stringify(clean) }
  });
  return clean;
}

/**
 * Envía una notificación al equipo por TODOS los canales configurados.
 * Devuelve cuántos emails salieron y si el WhatsApp se envió.
 */
export async function notifyTeam(opts: {
  subject: string;
  text: string;
  html?: string;
}): Promise<{ email: number; whatsapp: boolean }> {
  const cfg = await getTeamNotifyConfig();
  const out = { email: 0, whatsapp: false };

  // ── Email a todos los destinatarios ──
  if (isEmailEnabled()) {
    for (const to of cfg.emails) {
      try {
        await sendEmail({ to, subject: opts.subject, html: opts.html ?? `<p>${opts.text}</p>`, text: opts.text });
        out.email++;
      } catch (e: any) {
        console.warn("[bubui team-notify email]", to, e?.message ?? e);
      }
    }
  }

  // ── WhatsApp (proveedor activo del primer workspace, como NV Leads Pro) ──
  if (cfg.whatsapp) {
    try {
      const { sendText, normalizePhone } = await import("@/lib/leads/waha");
      const phone = normalizePhone(cfg.whatsapp);
      if (phone) {
        const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
        if (ws) {
          await sendText({
            workspaceId: ws.id,
            phoneNormalized: phone,
            text: `🔔 *Bubui — ${opts.subject}*\n\n${opts.text}`
          });
          out.whatsapp = true;
        }
      }
    } catch (e: any) {
      console.warn("[bubui team-notify whatsapp]", e?.message ?? e);
    }
  }

  return out;
}
