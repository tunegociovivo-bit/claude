/**
 * Cuenta de correo IMAP/SMTP del usuario (ej. info@negociovivo.com en
 * hosting propio). Sonia la usa para buscar/leer/enviar correos SOLO
 * en nombre del usuario dueño, y SOLO cuando ese usuario se lo pide
 * desde su sesión (gating en chat-tools por api.userId).
 *
 * IMAP (lectura) vía imapflow. SMTP (envío) vía nodemailer.
 * Password cifrada con lib/ai/crypto.ts (idealmente una app-password).
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";
import { createHash } from "node:crypto";

// Timeouts: sin esto, si el servidor de correo no responde (puerto
// bloqueado, host caído, firewall que descarta paquetes) la conexión se
// queda colgada indefinidamente, el endpoint nunca responde y el navegador
// corta con "Failed to fetch". Con timeouts cortos fallamos rápido con un
// mensaje útil (ETIMEDOUT) en vez de colgarnos.
const IMAP_TIMEOUTS = {
  connectionTimeout: 12000, // ms para abrir el socket
  greetingTimeout: 12000, // ms esperando el saludo del servidor
  socketTimeout: 30000 // ms de inactividad
};
const SMTP_TIMEOUTS = {
  connectionTimeout: 9000,
  greetingTimeout: 9000,
  socketTimeout: 30000
};

/** Rechaza si la promesa no resuelve en `ms` (red de seguridad). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: tiempo de espera agotado (${ms / 1000}s) — el servidor no responde (puerto bloqueado o host inaccesible).`)), ms)
    )
  ]);
}

/** ¿El error es de conexión (puerto bloqueado) y no de auth/lógica? */
function isSmtpConnIssue(e: any): boolean {
  const code = e?.code ?? "";
  if (["ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) return true;
  return /timeout|ECONN|socket|network/i.test(String(e?.message ?? ""));
}

type SmtpCandidate = { port: number; secure: boolean };

/** Puertos SMTP a probar: el configurado primero, luego alternativas
 *  comunes por si el principal está bloqueado por el hosting/egress. */
function smtpCandidates(port: number, secure: boolean): SmtpCandidate[] {
  const cands: SmtpCandidate[] = [{ port, secure }];
  for (const c of [
    { port: 587, secure: false }, // STARTTLS
    { port: 465, secure: true }, // SSL implícito
    { port: 25, secure: false } // sin cifrar (último recurso)
  ]) {
    if (!cands.some((x) => x.port === c.port)) cands.push(c);
  }
  return cands;
}

/**
 * Ejecuta una operación SMTP (verify / sendMail) probando varios puertos.
 * Si el puerto configurado falla por CONEXIÓN (timeout/refused) prueba el
 * siguiente; si falla por auth, aborta (cambiar de puerto no ayuda).
 * Devuelve el resultado + el puerto/secure que funcionó.
 */
async function runSmtpWithFallback<T>(
  opts: { host: string; loginUser: string; password: string; port: number; secure: boolean; perTryMs: number },
  fn: (transport: any) => Promise<T>
): Promise<{ value: T; port: number; secure: boolean }> {
  const nodemailer = (await import("nodemailer")).default;
  let lastErr: any = new Error("SMTP: sin candidatos");
  for (const cand of smtpCandidates(opts.port, opts.secure)) {
    try {
      const transport = nodemailer.createTransport({
        host: opts.host,
        port: cand.port,
        secure: cand.secure,
        auth: { user: opts.loginUser, pass: opts.password },
        ...SMTP_TIMEOUTS
      });
      const value = await withTimeout(fn(transport), opts.perTryMs, "SMTP");
      return { value, port: cand.port, secure: cand.secure };
    } catch (e: any) {
      lastErr = e;
      if (!isSmtpConnIssue(e)) throw e; // auth u otro error lógico: no reintentar
    }
  }
  throw lastErr;
}

export type EmailSummary = {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
};

function toIso(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

async function loadAccount(userId: string, workspaceId: string) {
  // Primero la cuenta del propio usuario; si no tiene (p.ej. Sonia autónoma
  // corre como usuario-bot), cae a CUALQUIER cuenta configurada del workspace
  // (la cuenta compartida del negocio, p.ej. info@negociovivo.com).
  let acc = await prisma.emailAccount.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } }
  });
  if (!acc) {
    acc = await prisma.emailAccount.findFirst({ where: { workspaceId } });
  }
  if (!acc) throw new Error("No hay cuenta de correo conectada en el workspace. Configúrala en perfil → Mi correo (/perfil/correo).");
  const password = decryptSecret(acc.passwordEnc);
  if (!password) throw new Error("Contraseña de correo corrupta — reconfigúrala.");
  return { acc, password };
}

/** Verifica que IMAP y SMTP conecten con las credenciales dadas. */
export async function testEmailAccount(opts: {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  loginUser: string;
  password: string;
  /** ¿Hay relay HTTP (Resend) disponible para este workspace? Lo calcula
   *  la ruta (que tiene workspaceId) y lo pasa para el mensaje. */
  relayAvailable?: boolean;
}): Promise<{ imap: boolean; smtp: boolean; relay?: boolean; error?: string; smtpPort?: number; smtpSecure?: boolean }> {
  const result = {
    imap: false,
    smtp: false,
    relay: false,
    error: undefined as string | undefined,
    smtpPort: undefined as number | undefined,
    smtpSecure: undefined as boolean | undefined
  };
  // IMAP
  try {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: opts.imapHost,
      port: opts.imapPort,
      secure: opts.imapSecure,
      auth: { user: opts.loginUser, pass: opts.password },
      logger: false,
      ...IMAP_TIMEOUTS
    });
    await withTimeout(client.connect(), 15000, "IMAP");
    await client.logout().catch(() => {});
    result.imap = true;
  } catch (e: any) {
    // imapflow trae detalle útil que no está en .message: si la auth
    // fue rechazada, el texto de respuesta del servidor, y el código.
    const parts = [String(e?.message ?? e)];
    if (e?.authenticationFailed) parts.push("(autenticación rechazada — revisa usuario/contraseña o usa una contraseña de aplicación)");
    if (e?.responseText && !parts[0].includes(e.responseText)) parts.push(`resp: ${e.responseText}`);
    if (e?.serverResponseCode) parts.push(`code: ${e.serverResponseCode}`);
    result.error = `IMAP: ${parts.join(" ").slice(0, 240)}`;
  }
  // SMTP — con fallback de puerto (465 SSL → 587 STARTTLS → 25).
  try {
    const { port, secure } = await runSmtpWithFallback(
      {
        host: opts.smtpHost,
        loginUser: opts.loginUser,
        password: opts.password,
        port: opts.smtpPort,
        secure: opts.smtpSecure,
        perTryMs: 11000
      },
      (t) => t.verify()
    );
    result.smtp = true;
    result.smtpPort = port;
    result.smtpSecure = secure;
  } catch (e: any) {
    // SMTP bloqueado: ¿hay relay HTTP (Resend) disponible? Si sí, el envío
    // de Sonia funcionará igualmente por ahí — no es un fallo fatal.
    if (isSmtpConnIssue(e) && opts.relayAvailable) {
      result.relay = true;
    }
    const parts = [String(e?.message ?? e)];
    if (e?.code) parts.push(`code: ${e.code}`);
    if (isSmtpConnIssue(e)) {
      parts.push(
        result.relay
          ? "(SMTP bloqueado, pero el envío funcionará por relay HTTP — Resend)"
          : "(ningún puerto SMTP conecta — 465/587/25 bloqueados desde el servidor. Configura el relay pegando la clave de Resend abajo, o desbloquea SMTP en Railway)"
      );
    }
    result.error = (result.error ? result.error + " · " : "") + `SMTP: ${parts.join(" ").slice(0, 240)}`;
  }
  return result;
}

/**
 * Busca correos. `query` admite criterios simples que mapeamos a IMAP:
 *   - texto libre → busca en asunto + cuerpo
 *   - "from:alguien@x.com" → remitente
 *   - "unseen" / "no leídos" → solo no leídos
 *   - "since:YYYY-MM-DD" → desde fecha
 * Devuelve los más recientes primero.
 */
export async function searchEmails(opts: {
  userId: string;
  workspaceId: string;
  query?: string;
  mailbox?: string;
  max?: number;
}): Promise<EmailSummary[]> {
  const { acc, password } = await loadAccount(opts.userId, opts.workspaceId);
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: acc.imapHost,
    port: acc.imapPort,
    secure: acc.imapSecure,
    auth: { user: acc.loginUser, pass: password },
    logger: false,
    ...IMAP_TIMEOUTS
  });
  const max = Math.min(opts.max ?? 10, 25);
  const out: EmailSummary[] = [];
  await withTimeout(client.connect(), 15000, "IMAP");
  try {
    const lock = await client.getMailboxLock(opts.mailbox ?? "INBOX");
    try {
      const q = (opts.query ?? "").trim();
      const criteria: any = {};
      if (/unseen|no le[ií]dos?|sin leer/i.test(q)) criteria.seen = false;
      const fromMatch = q.match(/from:(\S+)/i);
      if (fromMatch) criteria.from = fromMatch[1];
      const sinceMatch = q.match(/since:(\d{4}-\d{2}-\d{2})/i);
      if (sinceMatch) criteria.since = new Date(sinceMatch[1]);
      // Texto libre restante → busca en asunto O cuerpo
      const freeText = q
        .replace(/from:\S+/gi, "")
        .replace(/since:\d{4}-\d{2}-\d{2}/gi, "")
        .replace(/unseen|no le[ií]dos?|sin leer/gi, "")
        .trim();
      // imapflow: si hay texto, usamos OR de subject/body
      const searchSpec: any =
        freeText.length > 1
          ? { ...criteria, or: [{ subject: freeText }, { body: freeText }] }
          : Object.keys(criteria).length > 0
            ? criteria
            : { all: true };

      const uids = (await client.search(searchSpec, { uid: true })) || [];
      const lastUids = uids.slice(-max).reverse();
      for (const uid of lastUids) {
        const msg = await client.fetchOne(
          String(uid),
          { envelope: true, bodyParts: ["text"], internalDate: true },
          { uid: true }
        );
        if (!msg || typeof msg === "boolean") continue;
        const env: any = msg.envelope ?? {};
        const from = (env.from ?? []).map((a: any) => a.address).join(", ");
        const to = (env.to ?? []).map((a: any) => a.address).join(", ");
        out.push({
          uid: Number(uid),
          from,
          to,
          subject: env.subject ?? "(sin asunto)",
          date: toIso(msg.internalDate ?? env.date),
          snippet: ""
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

/** Lee el cuerpo completo (texto) de un correo por UID. */
export async function readEmail(opts: {
  userId: string;
  workspaceId: string;
  uid: number;
  mailbox?: string;
}): Promise<EmailSummary & { body: string }> {
  const { acc, password } = await loadAccount(opts.userId, opts.workspaceId);
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: acc.imapHost,
    port: acc.imapPort,
    secure: acc.imapSecure,
    auth: { user: acc.loginUser, pass: password },
    logger: false,
    ...IMAP_TIMEOUTS
  });
  await withTimeout(client.connect(), 15000, "IMAP");
  try {
    const lock = await client.getMailboxLock(opts.mailbox ?? "INBOX");
    try {
      const msg = await client.fetchOne(
        String(opts.uid),
        { envelope: true, source: true, internalDate: true },
        { uid: true }
      );
      if (!msg || typeof msg === "boolean") throw new Error("Correo no encontrado");
      const env: any = msg.envelope ?? {};
      let body = "";
      try {
        const { simpleParser } = await import("mailparser");
        const parsed = await simpleParser(msg.source as Buffer);
        body = (parsed.text ?? parsed.html ?? "").toString().slice(0, 8000);
      } catch {
        body = (msg.source as Buffer)?.toString("utf8").slice(0, 4000) ?? "";
      }
      return {
        uid: opts.uid,
        from: (env.from ?? []).map((a: any) => a.address).join(", "),
        to: (env.to ?? []).map((a: any) => a.address).join(", "),
        subject: env.subject ?? "(sin asunto)",
        date: toIso(msg.internalDate),
        snippet: "",
        body
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Envía un correo desde la cuenta del usuario (SMTP). */
export async function sendEmailFromAccount(opts: {
  userId: string;
  workspaceId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  html?: boolean;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<{ messageId: string; via?: "smtp" | "relay" }> {
  const { acc, password } = await loadAccount(opts.userId, opts.workspaceId);
  try {
    const { value: info, port, secure } = await runSmtpWithFallback<any>(
      {
        host: acc.smtpHost,
        loginUser: acc.loginUser,
        password,
        port: acc.smtpPort,
        secure: acc.smtpSecure,
        perTryMs: 20000
      },
      (t) =>
        t.sendMail({
          from: acc.email,
          to: opts.to,
          cc: opts.cc,
          subject: opts.subject,
          attachments: opts.attachments,
          ...(opts.html ? { html: opts.body } : { text: opts.body })
        })
    );
    // Self-heal: si funcionó un puerto distinto al guardado, lo persistimos
    // para que el próximo envío vaya directo y la UI lo refleje.
    if (port !== acc.smtpPort || secure !== acc.smtpSecure) {
      await prisma.emailAccount
        .update({ where: { id: acc.id }, data: { smtpPort: port, smtpSecure: secure } })
        .catch(() => {});
    }
    return { messageId: info.messageId, via: "smtp" };
  } catch (e: any) {
    // SMTP bloqueado (Railway corta 465/587/25). Si hay relay HTTP (Resend),
    // enviamos por ahí como info@negociovivo.com. Si el dominio no está
    // verificado en Resend, reintentamos con el remitente por defecto +
    // reply-to a la cuenta del usuario para no perder el correo.
    const { getResendConfig, sendViaResend } = await import("@/lib/integrations/email");
    const rcfg = await getResendConfig(opts.workspaceId);
    if (!isSmtpConnIssue(e) || !rcfg.apiKey) throw e;
    const common = {
      apiKey: rcfg.apiKey,
      to: opts.to,
      cc: opts.cc,
      subject: opts.subject,
      ...(opts.html ? { html: opts.body } : { text: opts.body }),
      attachments: opts.attachments
    };
    try {
      // Remitente principal: si el "from" configurado incluye la dirección
      // de la cuenta (p.ej. "Negocio Vivo <info@negociovivo.com>"), lo
      // usamos para respetar el nombre visible; si no, la dirección a secas.
      const fromPrimary =
        rcfg.from && rcfg.from.toLowerCase().includes(acc.email.toLowerCase()) ? rcfg.from : acc.email;
      const r = await sendViaResend({ from: fromPrimary, replyTo: acc.email, ...common });
      return { messageId: r.id, via: "relay" };
    } catch (re: any) {
      if (re?.domainNotVerified) {
        const r2 = await sendViaResend({ from: rcfg.from, replyTo: acc.email, ...common });
        return { messageId: r2.id, via: "relay" };
      }
      throw re;
    }
  }
}

export type BillingPdfAttachment = {
  accountId: string;
  filename: string;
  content: Buffer;
  messageDate: Date | null;
  subject: string;
  amountCents: number | null;
  hash: string;
};

/** Busca recibos PDF de Meta en el buzón configurado, sin mover ni marcar correos. */
export async function findMetaBillingPdfAttachments(opts: {
  userId: string;
  workspaceId: string;
  from: Date;
  to: Date;
  accountIds: string[];
}): Promise<BillingPdfAttachment[]> {
  const { acc, password } = await loadAccount(opts.userId, opts.workspaceId);
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({ host: acc.imapHost, port: acc.imapPort, secure: acc.imapSecure, auth: { user: acc.loginUser, pass: password }, logger: false, ...IMAP_TIMEOUTS });
  await withTimeout(client.connect(), 15_000, "IMAP");
  const found: BillingPdfAttachment[] = [];
  const hashes = new Set<string>();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ since: opts.from, before: new Date(opts.to.getTime() + 1) }, { uid: true })) || [];
      for (const uid of uids.slice(-500)) {
        const message = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
        if (!message || typeof message === "boolean" || !message.source) continue;
        const parsed = await simpleParser(message.source as Buffer);
        const subject = String(parsed.subject || "");
        const from = parsed.from?.text || "";
        const searchable = `${subject}\n${from}\n${parsed.text || ""}\n${typeof parsed.html === "string" ? parsed.html : ""}`;
        if (!/(facebookmail\.com|facebook\.com|meta\.com|meta platforms|recibo.*meta|meta.*recibo)/i.test(searchable)) continue;
        const normalized = searchable.replace(/[\s-]/g, "");
        const accountId = opts.accountIds.find((id) => normalized.includes(id.replace(/\D/g, "")));
        if (!accountId) continue;
        const amountMatch = searchable.match(/(?:total|importe|amount)[^\d]{0,30}(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))\s*(?:€|EUR)/i);
        const amountCents = amountMatch ? Math.round(Number(amountMatch[1].replace(/[.\s]/g, "").replace(",", ".")) * 100) : null;
        for (const attachment of parsed.attachments || []) {
          const content = Buffer.from(attachment.content);
          if (attachment.contentType !== "application/pdf" && !/\.pdf$/i.test(attachment.filename || "")) continue;
          if (content.subarray(0, 4).toString("ascii") !== "%PDF") continue;
          const hash = createHash("sha256").update(content).digest("hex");
          if (hashes.has(hash)) continue;
          hashes.add(hash);
          const rawDate = parsed.date || message.internalDate;
          found.push({ accountId, filename: attachment.filename || `meta-${accountId}-${uid}.pdf`, content, messageDate: rawDate ? new Date(rawDate) : null, subject, amountCents, hash });
        }
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return found;
}

export async function getEmailAccountStatus(userId: string, workspaceId: string) {
  const acc = await prisma.emailAccount.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { email: true, imapHost: true, smtpHost: true, createdAt: true, lastError: true }
  });
  return acc;
}
