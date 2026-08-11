import "server-only";

// Aviso operativo por email a Negocio Vivo (Resend por REST, sin SDK).
// Nunca lanza: devuelve ok/error para que el llamante decida qué persistir.
// Aquí no viajan credenciales ni tokens — solo datos operativos mínimos.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function opsEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function opsEmailRecipient(): string {
  return process.env.PHONE_NOTIFY_TO || "info@negociovivo.com";
}

function opsEmailSender(): string {
  return process.env.PHONE_NOTIFY_FROM || "CRM Ventas <onboarding@resend.dev>";
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export async function sendOpsEmail(opts: {
  subject: string;
  to?: string;
  // Pares etiqueta → valor ya seguros (sin secretos); se escapan al renderizar.
  rows: Array<[string, string]>;
  actionUrl?: string;
  actionLabel?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "EMAIL_NOT_CONFIGURED" };
  const rowsHtml = opts.rows
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`)
    .join("");
  const action = opts.actionUrl
    ? `<p style="margin-top:16px"><a href="${escapeHtml(opts.actionUrl)}" style="background:#2f6bff;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">${escapeHtml(opts.actionLabel || "Abrir")}</a></p>`
    : "";
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#0f172a"><p>${escapeHtml(opts.subject)}</p><table style="border-collapse:collapse">${rowsHtml}</table>${action}</div>`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: opsEmailSender(), to: [opts.to || opsEmailRecipient()], subject: opts.subject, html }),
      });
      if (!response.ok) {
        // El cuerpo de error de Resend no se registra entero por si citara cabeceras.
        return { ok: false, error: `EMAIL_HTTP_${response.status}` };
      }
      return { ok: true };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return { ok: false, error: (error as Error)?.name === "AbortError" ? "EMAIL_TIMEOUT" : "EMAIL_NETWORK" };
  }
}
