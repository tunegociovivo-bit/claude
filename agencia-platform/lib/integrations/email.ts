/**
 * Wrapper de email. Usa Resend si RESEND_API_KEY está configurado.
 * Sin clave: isEmailEnabled() → false, los endpoints lo detectan y
 * caen al modo "descarga manual del CSV".
 *
 * Resend tiene plan gratuito de 100 emails/día y dominio resend.dev
 * para pruebas sin verificar dominio propio.
 */

/**
 * Remitente por defecto: el dominio negociovivo.com está VERIFICADO en Resend, así que
 * `info@negociovivo.com` enruta a cualquier destinatario. (El anterior `onboarding@resend.dev`
 * es el dominio de PRUEBAS de Resend y provoca 403 "testing-only" a destinatarios externos.)
 */
export const DEFAULT_FROM = "Negocio Vivo <info@negociovivo.com>";
/** Remitente FORZADO para el envío de leads: siempre info@negociovivo.com (dominio verificado). */
export const LEADS_FROM = DEFAULT_FROM;

export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Estado de configuración de email teniendo en cuenta TANTO la env var como la clave
 * guardada en la bóveda del workspace (Workspace.settings.integrations.resend, cifrada).
 * Async y sin exponer la clave. Robusto ante que `RESEND_API_KEY` no esté disponible en el
 * runtime: si el admin la guardó en /admin/secretos, el email sigue configurado.
 */
export async function emailConfigStatus(workspaceId?: string): Promise<{ configured: boolean; source: "env" | "vault" | "none" }> {
  if (process.env.RESEND_API_KEY) return { configured: true, source: "env" };
  if (workspaceId) {
    try {
      const { apiKey } = await getResendConfig(workspaceId);
      if (apiKey) return { configured: true, source: "vault" };
    } catch {
      /* bóveda inaccesible → tratamos como no configurado */
    }
  }
  return { configured: false, source: "none" };
}

/** ¿Hay email configurado (env o bóveda del workspace)? Versión async recomendada. */
export async function isEmailConfigured(workspaceId?: string): Promise<boolean> {
  return (await emailConfigStatus(workspaceId)).configured;
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
  let from = process.env.EMAIL_FROM ?? DEFAULT_FROM;
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
  // Default: dominio propio VERIFICADO en Resend (info@negociovivo.com).
  return process.env.EMAIL_FROM ?? DEFAULT_FROM;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Copia oculta: p.ej. todos los directivos de marketing de la empresa. */
  bcc?: string | string[];
  /** Si se aporta, la clave/remitente de la BÓVEDA del workspace tienen prioridad sobre la
   *  env var (permite reenviar sin depender de RESEND_API_KEY en el runtime). */
  workspaceId?: string;
  /** Remitente FORZADO (máxima prioridad). Úsalo para fijar info@negociovivo.com en leads. */
  from?: string;
  /** Reply-To opcional (se mantiene solo si se aporta). */
  replyTo?: string;
  /** Evita duplicar un correo cuando se reintenta una misma operación. */
  idempotencyKey?: string;
}): Promise<{ id: string }> {
  // Resuelve la clave por bóveda (prioridad) o env. Sin workspaceId → comportamiento previo
  // (solo env). Así callers existentes no cambian, y el path de leads usa la bóveda.
  const { apiKey, from: resolvedFrom } = await getResendConfig(opts.workspaceId);
  if (!apiKey) {
    throw new Error("Email no configurado. Define RESEND_API_KEY o guarda la clave de Resend en /admin/secretos.");
  }
  // Prioridad del remitente: `opts.from` forzado > EMAIL_FROM/bóveda > default verificado.
  const from = opts.from ?? resolvedFrom;
  const bccList = (Array.isArray(opts.bcc) ? opts.bcc : opts.bcc ? [opts.bcc] : []).filter(Boolean);
  const payload = JSON.stringify({
    from,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    ...(bccList.length ? { bcc: bccList } : {}),
    ...(opts.replyTo ? { reply_to: opts.replyTo } : {})
  });
  // Reintentos con backoff ante fallos transitorios (429 rate limit, 5xx,
  // timeouts de red). Los 4xx deterministas (400/401/403/422) no se reintentan.
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {})
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
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
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
  if (opts.attachments?.length) payload.attachments = opts.attachments.map((attachment) => ({ filename: attachment.filename, content: attachment.content.toString("base64"), content_type: attachment.contentType }));
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
  workspaceId?: string;
  from?: string;
  bcc?: string | string[];
  replyTo?: string;
  idempotencyKey?: string;
  attachment: { filename: string; content: string | Buffer; contentType: string };
}): Promise<{ id: string }> {
  const { apiKey, from: resolvedFrom } = await getResendConfig(opts.workspaceId);
  if (!apiKey) throw new Error("Email no configurado. Define RESEND_API_KEY o guarda la clave de Resend en /admin/secretos.");

  const contentBase64 =
    typeof opts.attachment.content === "string"
      ? Buffer.from(opts.attachment.content, "utf-8").toString("base64")
      : opts.attachment.content.toString("base64");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {})
    },
    body: JSON.stringify({
      from: opts.from ?? resolvedFrom,
      to: [opts.to],
      ...(opts.bcc ? { bcc: Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc] } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: [
        {
          filename: opts.attachment.filename,
          content: contentBase64,
          content_type: opts.attachment.contentType
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
