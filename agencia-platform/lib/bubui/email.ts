/**
 * Emails transaccionales de Bubui (Resend vía lib/integrations/email).
 *
 * Todos los envíos son "best-effort": si RESEND_API_KEY no está configurada
 * (isEmailEnabled() === false) o el envío falla, NO se lanza el error hacia
 * el flujo principal — solo se loguea. Un email que no sale nunca debe tirar
 * una compra ni un cron.
 */

import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";

const BRAND = "#EC4899";
const PUBLIC_URL = process.env.NEXT_PUBLIC_BUBUI_URL || "https://bubui.app";

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FDF2E1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="text-align:center;margin-bottom:20px">
      <span style="font-size:30px;font-weight:800;color:${BRAND};letter-spacing:-1px">bubui</span>
    </div>
    <div style="background:#fff;border-radius:18px;padding:28px 24px;box-shadow:0 2px 14px rgba(0,0,0,.06)">
      <h1 style="font-size:19px;margin:0 0 14px">${title}</h1>
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#9a8f80;font-size:11px;margin-top:18px">
      Ahorra. Disfruta. Apoya local. · Una app de Negocio Vivo<br/>
      <a href="${PUBLIC_URL}" style="color:#9a8f80">bubui.app</a>
    </p>
  </div></body></html>`;
}

function btn(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;font-size:15px">${label}</a>`;
}

/** Email al cliente cuando el negocio confirma su compra. */
export async function sendPurchaseConfirmationEmail(opts: {
  to: string;
  customerName?: string | null;
  businessName: string;
  amount: number;
  discountAmount: number;
  offersUnlocked: number;
}): Promise<void> {
  if (!isEmailEnabled()) return;
  const saved = opts.discountAmount.toFixed(2);
  const hello = opts.customerName ? `Hola ${opts.customerName},` : "¡Hola!";
  const offersLine =
    opts.offersUnlocked > 0
      ? `<p style="margin:0 0 16px">Y lo mejor: has desbloqueado <b>${opts.offersUnlocked} ${
          opts.offersUnlocked === 1 ? "descuento nuevo" : "descuentos nuevos"
        }</b> en negocios cerca de ti. Ábrelos en la app antes de que caduquen.</p>`
      : "";
  const html = shell(
    `Compra confirmada en ${opts.businessName}`,
    `<p style="margin:0 0 12px">${hello}</p>
     <p style="margin:0 0 12px">Tu compra de <b>${opts.amount.toFixed(
       2
     )} €</b> en <b>${opts.businessName}</b> está confirmada.</p>
     <p style="margin:0 0 16px;font-size:17px">Has ahorrado <b style="color:${BRAND}">${saved} €</b> 🎉</p>
     ${offersLine}
     <p style="margin:18px 0 0;text-align:center">${btn(`${PUBLIC_URL}/app`, "Ver mis descuentos")}</p>`
  );
  try {
    await sendEmail({
      to: opts.to,
      subject: `Compra confirmada en ${opts.businessName} · ahorraste ${saved} €`,
      html,
      text: `${hello} Tu compra de ${opts.amount.toFixed(2)} € en ${opts.businessName} está confirmada. Has ahorrado ${saved} €.${
        opts.offersUnlocked > 0 ? ` Has desbloqueado ${opts.offersUnlocked} descuentos nuevos cerca.` : ""
      } Ábrelos en ${PUBLIC_URL}/app`
    });
  } catch (e: any) {
    console.warn("[bubui email purchase]", e?.message ?? e);
  }
}

/** Email al cliente avisando de cupones a punto de caducar. */
export async function sendOfferExpiringEmail(opts: {
  to: string;
  customerName?: string | null;
  count: number;
  firstBusinessName: string;
  urgent: boolean;
}): Promise<void> {
  if (!isEmailEnabled()) return;
  const hello = opts.customerName ? `Hola ${opts.customerName},` : "¡Hola!";
  const when = opts.urgent ? "caducan hoy" : "caducan mañana";
  const headline =
    opts.count === 1
      ? `Tu cupón en ${opts.firstBusinessName} ${when}`
      : `Tienes ${opts.count} cupones que ${when}`;
  const html = shell(
    `⏰ ${headline}`,
    `<p style="margin:0 0 12px">${hello}</p>
     <p style="margin:0 0 16px">${
       opts.count === 1
         ? `Tu descuento en <b>${opts.firstBusinessName}</b> ${when}. No lo dejes escapar.`
         : `Tienes <b>${opts.count} descuentos</b> que ${when}. Échales un ojo antes de que sea tarde.`
     }</p>
     <p style="margin:18px 0 0;text-align:center">${btn(`${PUBLIC_URL}/app`, "Usar mis cupones")}</p>`
  );
  try {
    await sendEmail({
      to: opts.to,
      subject: `⏰ ${headline}`,
      html,
      text: `${hello} ${headline}. Úsalos en ${PUBLIC_URL}/app`
    });
  } catch (e: any) {
    console.warn("[bubui email expiring]", e?.message ?? e);
  }
}

/** Email al dueño del negocio con el enlace para restablecer su contraseña. */
export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  if (!isEmailEnabled()) return;
  const html = shell(
    "Restablece tu contraseña",
    `<p style="margin:0 0 12px">Has pedido restablecer la contraseña de tu panel de negocio en Bubui.</p>
     <p style="margin:0 0 16px">Pulsa el botón para elegir una nueva. El enlace caduca en 1 hora. Si no fuiste tú, ignora este correo.</p>
     <p style="margin:18px 0 0;text-align:center">${btn(opts.resetUrl, "Crear nueva contraseña")}</p>
     <p style="margin:18px 0 0;font-size:12px;color:#888">Si el botón no funciona, copia este enlace:<br/>${opts.resetUrl}</p>`
  );
  try {
    await sendEmail({
      to: opts.to,
      subject: "Restablece tu contraseña de Bubui",
      html,
      text: `Restablece tu contraseña de Bubui (enlace válido 1 hora): ${opts.resetUrl}`
    });
  } catch (e: any) {
    console.warn("[bubui email reset]", e?.message ?? e);
  }
}

/**
 * Aviso interno al equipo cuando un negocio pide que le llevemos el cartel
 * impreso a su local. Va por TODOS los canales del equipo configurados en el
 * admin (emails + WhatsApp, ver lib/bubui/team-notify). Best-effort: la
 * solicitud siempre queda en el panel admin → Comercios → Carteles por
 * entregar aunque ningún canal esté operativo.
 */
export async function sendPosterDeliveryRequestEmail(opts: {
  businessName: string;
  address: string;
  phone?: string | null;
  note?: string | null;
}): Promise<void> {
  const html = shell(
    "🚚 Cartel por entregar",
    `<p style="margin:0 0 12px">El negocio <b>${opts.businessName}</b> ha pedido que le llevemos el cartel impreso a su local.</p>
     <p style="margin:0 0 6px">📍 <b>Dirección:</b> ${opts.address}</p>
     ${opts.phone ? `<p style="margin:0 0 6px">☎ <b>Teléfono:</b> ${opts.phone}</p>` : ""}
     ${opts.note ? `<p style="margin:0 0 6px">📝 <b>Nota:</b> ${opts.note}</p>` : ""}
     <p style="margin:16px 0 0;font-size:13px;color:#888">También en el panel: Bubui admin → Comercios → Carteles por entregar.</p>`
  );
  try {
    const { notifyTeam } = await import("./team-notify");
    await notifyTeam({
      subject: `🚚 Cartel por entregar — ${opts.businessName}`,
      html,
      text: `${opts.businessName} pide entrega de cartel. Dirección: ${opts.address}${
        opts.phone ? ` · Tel: ${opts.phone}` : ""
      }${opts.note ? ` · Nota: ${opts.note}` : ""}`
    });
  } catch (e: any) {
    console.warn("[bubui email poster]", e?.message ?? e);
  }
}
