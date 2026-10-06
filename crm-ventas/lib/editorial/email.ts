/**
 * Envío del CSV de Metricool por email (Resend por REST, sin SDK). Portado de
 * `sendEmailWithAttachment` del Hub (lib/integrations/email.ts). La clave la
 * pone Negocio Vivo en el entorno (RESEND_API_KEY); el negocio nunca la ve.
 */

export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress(): string {
  return process.env.EDITORIAL_EMAIL_FROM || process.env.PHONE_NOTIFY_FROM || "Negocio Vivo <info@negociovivo.com>";
}

export async function sendEmailWithAttachment(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachment: { filename: string; content: string | Buffer; contentType: string };
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("El envío por email no está disponible; avisa a Negocio Vivo.");
  const contentBase64 =
    typeof opts.attachment.content === "string"
      ? Buffer.from(opts.attachment.content, "utf-8").toString("base64")
      : opts.attachment.content.toString("base64");
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddress(),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: [{ filename: opts.attachment.filename, content: contentBase64, content_type: opts.attachment.contentType }]
    }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}
