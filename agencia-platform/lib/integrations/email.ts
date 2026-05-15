/**
 * Wrapper de email. Usa Resend si RESEND_API_KEY está configurado.
 * Sin clave: isEmailEnabled() → false, los endpoints lo detectan y
 * caen al modo "descarga manual del CSV".
 *
 * Resend tiene plan gratuito de 100 emails/día y dominio resend.dev
 * para pruebas sin verificar dominio propio.
 */

export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function getFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    // Default: dominio de pruebas de Resend (válido sin verificar dominio propio)
    "Hub <onboarding@resend.dev>"
  );
}

export async function sendEmailWithAttachment(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachment: { filename: string; content: string | Buffer; contentType: string };
}): Promise<{ id: string }> {
  if (!isEmailEnabled()) {
    throw new Error("Email no configurado. Define RESEND_API_KEY en Railway.");
  }

  const contentBase64 =
    typeof opts.attachment.content === "string"
      ? Buffer.from(opts.attachment.content, "utf-8").toString("base64")
      : opts.attachment.content.toString("base64");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: [
        {
          filename: opts.attachment.filename,
          content: contentBase64
        }
      ]
    })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}
