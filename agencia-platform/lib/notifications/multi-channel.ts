/**
 * Notificaciones multi-canal fuera del Hub.
 *
 * Hoy Sonia te avisa solo en el Hub (badge en la card + voz) y email.
 * Pero si estás de viaje, fin de semana o simplemente NO tienes la
 * pestaña abierta, te enteras tarde.
 *
 * Premium: cuando una task pasa a REQUIRES_HUMAN o FAILED (señales
 * críticas), Sonia te empuja la notif fuera del Hub a:
 *   - WhatsApp (vía WAHA — phone del User)
 *   - Telegram (vía Bot API — chat_id del User)
 *
 * Config per-workspace en Workspace.settings.aiAgent.notificationChannels:
 * {
 *   [userId]: {
 *     whatsapp: { enabled, phone? },     // si phone null, usa User.phone
 *     telegram: { enabled, chatId },     // chatId de Telegram
 *     respectWorkingHours: true,         // si true, NO empuja durante horario
 *     workingHours: { start: 9, end: 19, timezone: "Europe/Madrid" },
 *     minLevel: "warning" | "critical"   // umbral para empujar
 *   }
 * }
 *
 * Telegram requires un bot. Config global en
 * Workspace.settings.integrations.telegram.botToken. Crear el bot
 * con @BotFather, copiar token. El user debe arrancar conversación
 * con el bot ("/start") y obtener su chat_id en @userinfobot o
 * dirigiendose al bot — sin esto, el bot no puede iniciar.
 */

import { prisma } from "@/lib/db/prisma";

export type NotifyOpts = {
  workspaceId: string;
  userId: string;
  level: "info" | "warning" | "critical";
  title: string;
  body: string;
  /** Link interno del Hub al que ir cuando el user clica la notif. */
  linkPath?: string;
};

export type NotifyResult = {
  attempted: string[];
  ok: string[];
  errors: Record<string, string>;
  skipped?: string;
};

const LEVEL_ORDER = { info: 0, warning: 1, critical: 2 };

export async function notifyHumanOutsideHub(opts: NotifyOpts): Promise<NotifyResult> {
  const result: NotifyResult = { attempted: [], ok: [], errors: {} };

  const ws = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { settings: true }
  });
  const settings = (ws?.settings as any) ?? {};
  const channels = settings?.aiAgent?.notificationChannels?.[opts.userId];
  if (!channels) {
    result.skipped = "user no tiene canales configurados";
    return result;
  }

  // Filtro por minLevel
  const minLevel = channels.minLevel ?? "warning";
  if (LEVEL_ORDER[opts.level] < LEVEL_ORDER[minLevel as keyof typeof LEVEL_ORDER]) {
    result.skipped = `level ${opts.level} < minLevel ${minLevel}`;
    return result;
  }

  // Filtro por horario laboral (si está activado, solo notifica FUERA)
  if (channels.respectWorkingHours !== false) {
    const wh = channels.workingHours ?? {
      start: 9,
      end: 19,
      timezone: "Europe/Madrid"
    };
    const now = new Date();
    const hourInTz = Number(
      new Intl.DateTimeFormat("es-ES", {
        timeZone: wh.timezone,
        hour: "numeric",
        hour12: false
      }).format(now)
    );
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: wh.timezone,
      weekday: "short"
    }).format(now);
    const isWeekend = ["Sat", "Sun"].includes(day);
    const inWorkingHours = !isWeekend && hourInTz >= wh.start && hourInTz < wh.end;
    if (inWorkingHours && opts.level !== "critical") {
      result.skipped = "dentro de horario laboral (el Hub basta)";
      return result;
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { phone: true, name: true }
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://hub.negociovivo.app";
  const link = opts.linkPath ? `${baseUrl}${opts.linkPath}` : null;
  const fullText = [
    `${levelEmoji(opts.level)} *${opts.title}*`,
    "",
    opts.body,
    link ? `\n${link}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  // ── WhatsApp via WAHA ──────────────────────────────────────────
  if (channels.whatsapp?.enabled) {
    result.attempted.push("whatsapp");
    try {
      const phone = channels.whatsapp.phone || user?.phone;
      if (!phone) throw new Error("user sin teléfono");
      const { sendText, normalizePhone } = await import("@/lib/leads/waha");
      const phoneNormalized = normalizePhone(phone);
      if (!phoneNormalized) throw new Error("teléfono inválido");
      await sendText({
        workspaceId: opts.workspaceId,
        phoneNormalized,
        text: fullText
      });
      result.ok.push("whatsapp");
    } catch (e: any) {
      result.errors.whatsapp = e?.message ?? String(e);
    }
  }

  // ── Telegram via Bot API ───────────────────────────────────────
  if (channels.telegram?.enabled) {
    result.attempted.push("telegram");
    try {
      const botToken = settings?.integrations?.telegram?.botToken;
      if (!botToken) throw new Error("Telegram bot no configurado en workspace");
      const chatId = channels.telegram.chatId;
      if (!chatId) throw new Error("user sin chatId Telegram");
      const r = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: fullText,
            parse_mode: "Markdown",
            disable_web_page_preview: false
          })
        }
      );
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Telegram ${r.status}: ${t.slice(0, 200)}`);
      }
      result.ok.push("telegram");
    } catch (e: any) {
      result.errors.telegram = e?.message ?? String(e);
    }
  }

  return result;
}

function levelEmoji(level: "info" | "warning" | "critical"): string {
  if (level === "critical") return "🚨";
  if (level === "warning") return "⚠️";
  return "ℹ️";
}
