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

/**
 * Resuelve la clave de Resend + remitente. La clave guardada en la
 * plataforma (Workspace.settings.integrations.resend, cifrada) tiene
 * prioridad sobre la env var RESEND_API_KEY — así se puede configurar el
 * relay sin tocar Railway.
 */
export async function getResendConfig(
  workspaceId?: string
): Promise<{ apiKey: string | null; from: string }> {
  let apiKey: string | null = process.env.RESEND_API_KEY ?? null;
  let from = process.env.EMAIL_FROM ?? "Hub <onboarding@resend.dev>";
  if (workspaceId) {
    try {
      const { prisma } = await import("@/lib/db/prisma");
      const { decryptSecret } = await import("@/lib/ai/crypto");
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { settings: true }
      });
      const r = (ws?.settings as any)?.integrations?.resend;
      if (r?.apiKeyEnc) {
        const k = decryptSecret(r.apiKeyEnc);
        if (k) apiKey = k;
      }
      if (typeof r?.from === "string" && r.from.trim()) from = r.from.trim();
    } catch {
      /* settings inaccesible — usamos env */
    }
  }
  return { apiKey, from };
}

export function getFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    // Default: dominio de pruebas de Resend (válido sin verificar dominio propio)
    "Hub <onboarding@resend.dev>"
  );
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Copia oculta: p.ej. todos los directivos de marketing de la empresa. */
  bcc?: string | string[];
}): Promise<{ id: string }> {
  if (!isEmailEnabled()) {
    throw new Error("Email no configurado. Define RESEND_API_KEY.");
  }
  const bccList = (Array.isArray(opts.bcc) ? opts.bcc : opts.bcc ? [opts.bcc] : []).filter(Boolean);
  const payload = JSON.stringify({
    from: getFromAddress(),
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    ...(bccList.length ? { bcc: bccList } : {})
  });
  // Reintentos con backoff ante fallos transitorios (429 rate limit, 5xx,
  // timeouts de red). Los 4xx deterministas (400/401/403/422) no se reintentan.
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: payload,
        signal: AbortSignal.timeout(15000)
      });
      if (resp.ok) return resp.json();
      const body = await resp.text().catch(() => "");
      lastErr = `Resend ${resp.status}: ${body.slice(0, 200)}`;
      const retryable = resp.status === 429 || resp.status >= 500;
      if (!retryable || attempt === 3) throw new Error(lastErr);
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      if (attempt === 3) {
        console.warn("[email] fallo tras 3 intentos:", lastErr);
        throw new Error(lastErr);
      }
    }
    await new Promise((r) => setTimeout(r, attempt === 1 ? 800 : 2500));
  }
  throw new Error(lastErr || "Resend: error desconocido");
}

/**
 * Envío flexible por Resend (HTTP, puerto 443 — no bloqueado por Railway).
 * Permite remitente y reply-to personalizados. Lo usa el envío de correo
 * de Sonia cuando el SMTP del usuario está bloqueado: intenta enviar como
 * info@negociovivo.com (requiere el dominio verificado en Resend).
 *
 * `error.resendCode` (cuando aplica) permite al llamante distinguir un
 * fallo de dominio no verificado (para reintentar con remitente por
 * defecto) de otros errores.
 */
export async function sendViaResend(opts: {
  apiKey?: string;
  from?: string;
  replyTo?: string;
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
}): Promise<{ id: string }> {
  const apiKey = opts.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Relay de envío no configurado. Define RESEND_API_KEY o pega la clave de Resend en la plataforma.");
  }
  const payload: Record<string, unknown> = {
    from: opts.from ?? getFromAddress(),
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject
  };
  if (opts.cc) payload.cc = Array.isArray(opts.cc) ? opts.cc : [opts.cc];
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  if (opts.html) payload.html = opts.html;
  if (opts.text || !opts.html) payload.text = opts.text ?? "";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err: any = new Error(`Resend ${resp.status}: ${body.slice(0, 220)}`);
    err.resendStatus = resp.status;
    // Resend devuelve 403/422 cuando el dominio del "from" no está verificado.
    err.domainNotVerified =
      resp.status === 403 || /domain is not verified|not verified|validation_error/i.test(body);
    throw err;
  }
  return resp.json();
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
