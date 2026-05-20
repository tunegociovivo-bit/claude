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
  connectionTimeout: 12000,
  greetingTimeout: 12000,
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
  const acc = await prisma.emailAccount.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } }
  });
  if (!acc) throw new Error("No tienes una cuenta de correo conectada. Configúrala en tu perfil → Mi correo (/perfil/correo).");
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
}): Promise<{ imap: boolean; smtp: boolean; error?: string }> {
  const result = { imap: false, smtp: false, error: undefined as string | undefined };
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
    result.error = `IMAP: ${String(e?.message ?? e).slice(0, 180)}`;
  }
  // SMTP
  try {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: opts.smtpHost,
      port: opts.smtpPort,
      secure: opts.smtpSecure,
      auth: { user: opts.loginUser, pass: opts.password },
      ...SMTP_TIMEOUTS
    });
    await withTimeout(transport.verify(), 15000, "SMTP");
    result.smtp = true;
  } catch (e: any) {
    result.error = (result.error ? result.error + " · " : "") + `SMTP: ${String(e?.message ?? e).slice(0, 180)}`;
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
}): Promise<{ messageId: string }> {
  const { acc, password } = await loadAccount(opts.userId, opts.workspaceId);
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: acc.smtpHost,
    port: acc.smtpPort,
    secure: acc.smtpSecure,
    auth: { user: acc.loginUser, pass: password },
    ...SMTP_TIMEOUTS
  });
  const info = await withTimeout(transport.sendMail({
    from: acc.email,
    to: opts.to,
    cc: opts.cc,
    subject: opts.subject,
    ...(opts.html ? { html: opts.body } : { text: opts.body })
  }), 30000, "SMTP");
  return { messageId: info.messageId };
}

export async function getEmailAccountStatus(userId: string, workspaceId: string) {
  const acc = await prisma.emailAccount.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { email: true, imapHost: true, smtpHost: true, createdAt: true, lastError: true }
  });
  return acc;
}
