/**
 * Bandeja de ALERTAS DE EMPLEO (IMAP, solo lectura).
 *
 * En vez de scrapear los portales (caro/frágil), el usuario crea un buzón
 * dedicado (p.ej. un Gmail), configura ahí las "alertas de empleo" de LinkedIn /
 * InfoJobs / Indeed… y esas plataformas le envían por email las vacantes nuevas
 * que encajan. Este módulo lee ese buzón, extrae las ofertas y las convierte en
 * leads (empresas que contratan marketing/IA) sin gastar créditos de scraping.
 *
 * La extracción de cada email la hace la IA (Haiku): es robusta a cualquier
 * formato de plataforma y barata (1 llamada por email de alerta, que suele
 * listar muchas ofertas). Password IMAP cifrada con lib/ai/crypto (app-password).
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";
import { completeJson } from "@/lib/ai/anthropic";
import type { RawOffer } from "./jobs";
import { describeJobsInboxFailure } from "./jobs-inbox-status";
import { fetchUnreadGoogleMessages, googleJobsInboxConnected, markGoogleMessageRead, testGoogleJobsInbox } from "./jobs-gmail";

const IMAP_TIMEOUTS = { connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 30000 };

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}: tiempo de espera agotado (${ms / 1000}s)`)), ms))
  ]);
}

// Remitentes de alertas de empleo que procesamos (dominio del "from"). Evita
// dar de comer a la IA correos que no sean de portales de empleo.
const JOB_SENDERS = [
  "linkedin.com", "infojobs.net", "indeed.com", "glassdoor.com", "jobtoday",
  "tecnoempleo.com", "jobandtalent", "epreselec", "turijobs", "cornerjob",
  "googlealerts-noreply@google.com"
];

export function isJobAlertSender(fromAddress: string): boolean {
  const normalized = fromAddress.trim().toLowerCase();
  return JOB_SENDERS.some((sender) => normalized.includes(sender));
}

export type JobsInboxConfig = { host: string; port: number; user: string; pass: string; enabled: boolean };

/** Resuelve la config del buzón desde los Ajustes del workspace (o null). */
export async function getJobsInboxConfig(workspaceId: string): Promise<JobsInboxConfig | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const leads: any = (ws?.settings as any)?.leads ?? {};
  const pass = leads.jobsInboxPassEnc ? decryptSecret(leads.jobsInboxPassEnc) : null;
  const user = typeof leads.jobsInboxUser === "string" ? leads.jobsInboxUser.trim() : "";
  if (!pass || !user) return null;
  return {
    host: (leads.jobsInboxHost || "imap.gmail.com").trim(),
    port: Number(leads.jobsInboxPort) || 993,
    user,
    pass,
    enabled: !!leads.jobsInboxEnabled
  };
}

/**
 * Prueba la conexión IMAP del buzón (sin procesar nada): verifica credenciales y
 * cuenta cuántos correos no leídos hay y cuántos son de portales de empleo. Sirve
 * para separar un fallo de credenciales de un fallo de extracción. Admite
 * credenciales "en caliente" (del formulario, antes de guardar).
 */
export async function testJobsInbox(
  workspaceId: string,
  override?: { host?: string; port?: number; user?: string; pass?: string; forceStoredImap?: boolean }
): Promise<{ ok: boolean; error?: string; unseen?: number; jobUnseen?: number; recovery?: "imap" }> {
  let googleFailure: string | null = null;
  if (!override?.pass && !override?.forceStoredImap && await googleJobsInboxConnected(workspaceId)) {
    try {
      const result = await testGoogleJobsInbox(workspaceId);
      if (result.ok) return { ok: true, unseen: result.unseen, jobUnseen: result.unseen };
      googleFailure = "Vuelve a conectar la cuenta de Google.";
    } catch (error: any) {
      googleFailure = describeJobsInboxFailure(error).message;
    }
  }
  let cfg = await getJobsInboxConfig(workspaceId);
  if (override?.user && override?.pass) {
    cfg = {
      host: (override.host || cfg?.host || "imap.gmail.com").trim(),
      port: override.port || cfg?.port || 993,
      user: override.user.trim(),
      pass: override.pass,
      enabled: cfg?.enabled ?? false
    };
  }
  if (!cfg) return { ok: false, error: googleFailure ?? "Buzón no configurado. Guarda el correo y la contraseña de aplicación primero." };

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    ...IMAP_TIMEOUTS
  });
  try {
    await withTimeout(client.connect(), 15000, "IMAP");
  } catch (e: any) {
    const failure = describeJobsInboxFailure(e, "imap");
    return { ok: false, error: failure.message, errorCode: failure.code } as any;
  }
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      let jobUnseen = 0;
      for (const uid of uids.slice(0, 60)) {
        const msg = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
        if (!msg || typeof msg === "boolean") continue;
        const fromAddr = ((msg.envelope as any)?.from ?? []).map((a: any) => a.address ?? "").join(",").toLowerCase();
        if (isJobAlertSender(fromAddr)) jobUnseen++;
      }
      return { ok: true, unseen: uids.length, jobUnseen, recovery: googleFailure ? "imap" : undefined };
    } finally {
      lock.release();
    }
  } catch (e: any) {
    return { ok: false, error: `IMAP: ${String(e?.message ?? e).slice(0, 180)}` };
  } finally {
    await client.logout().catch(() => {});
  }
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    offers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          jobTitle: { type: "string" },
          location: { type: "string" },
          jobUrl: { type: "string" },
          description: { type: "string" }
        },
        required: ["company"]
      }
    }
  },
  required: ["offers"]
};

const EXTRACT_SYSTEM = `Eres un extractor de ofertas de empleo. Te paso el TEXTO de un email de alerta de
un portal de empleo (LinkedIn, InfoJobs, Indeed…). Devuelve TODAS las ofertas que aparezcan, cada una con:
- company: nombre de la EMPRESA que contrata (no el portal). Obligatorio.
- jobTitle: el puesto.
- location: ciudad/provincia si aparece.
- jobUrl: el enlace a la oferta si aparece (el href del puesto).
- description: si el email incluye texto de la oferta, un extracto (tal cual, en su idioma original — no traduzcas).
Ignora cabeceras, pies, banners, "ver más ofertas", enlaces de baja y publicidad. No inventes empresas.
Si el email no lista ofertas, devuelve {"offers": []}. Devuelve SOLO el JSON.`;

/** Extrae ofertas del texto de un email de alerta usando la IA. */
async function extractOffers(workspaceId: string, email: { from: string; subject: string; text: string }): Promise<RawOffer[]> {
  const body = (email.text || "").slice(0, 12000);
  if (body.trim().length < 20) return [];
  const board = /linkedin/i.test(email.from)
    ? "linkedin"
    : /infojobs/i.test(email.from)
      ? "infojobs"
      : /googlealerts/i.test(email.from)
        ? "google_alerts"
        : "email";
  let res: { offers?: any[] };
  try {
    res = await completeJson<{ offers?: any[] }>({
      workspaceId,
      model: "claude-haiku-4-5-20251001",
      system: EXTRACT_SYSTEM,
      user: `De: ${email.from}\nAsunto: ${email.subject}\n\n${body}\n\nExtrae las ofertas:`,
      schema: EXTRACT_SCHEMA,
      maxTokens: 1500
    });
  } catch {
    return [];
  }
  const offers = Array.isArray(res?.offers) ? res.offers : [];
  return offers
    .filter((o) => o && typeof o.company === "string" && o.company.trim())
    .map((o) => ({
      company: o.company.trim(),
      jobTitle: typeof o.jobTitle === "string" ? o.jobTitle.trim() : null,
      location: typeof o.location === "string" ? o.location.trim() : null,
      jobUrl: typeof o.jobUrl === "string" && /^https?:\/\//.test(o.jobUrl) ? o.jobUrl : null,
      companyUrl: null,
      board,
      description: typeof o.description === "string" && o.description.trim() ? o.description.trim().slice(0, 1800) : null
    }));
}

/**
 * Lee el buzón por IMAP, procesa los emails de alerta NO leídos de portales de
 * empleo, extrae sus ofertas con IA y marca esos emails como leídos. Devuelve las
 * ofertas encontradas + cuántos emails se procesaron.
 */
export async function fetchJobAlertOffers(workspaceId: string): Promise<{ offers: RawOffer[]; emails: number; error?: string; recovery?: "imap" }> {
  let googleFailure: string | null = null;
  if (await googleJobsInboxConnected(workspaceId)) {
    const offers: RawOffer[] = [];
    let emails = 0;
    try {
      const messages = await fetchUnreadGoogleMessages(workspaceId) ?? [];
      const { simpleParser } = await import("mailparser");
      for (const message of messages.slice(0, 30)) {
        const parsed = await simpleParser(message.raw);
        const from = parsed.from?.text ?? "";
        const fromAddress = parsed.from?.value.map((value) => value.address ?? "").join(",") ?? "";
        if (!isJobAlertSender(fromAddress)) continue;
        const text = (parsed.text || parsed.html || "").toString();
        offers.push(...await extractOffers(workspaceId, { from, subject: parsed.subject ?? "", text }));
        emails++;
        await markGoogleMessageRead(workspaceId, message.id);
      }
      return { offers, emails };
    } catch (error: any) { googleFailure = describeJobsInboxFailure(error).message; }
  }
  const cfg = await getJobsInboxConfig(workspaceId);
  if (!cfg) return { offers: [], emails: 0, error: googleFailure ?? "Buzón de alertas no configurado (Ajustes → Bandeja de alertas)." };

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    ...IMAP_TIMEOUTS
  });

  const offers: RawOffer[] = [];
  let emails = 0;
  try {
    await withTimeout(client.connect(), 15000, "IMAP");
  } catch (e: any) {
    return { offers, emails, error: describeJobsInboxFailure(e, "imap").message };
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      // Procesa como mucho 30 emails por pasada (acota tokens/latencia).
      for (const uid of uids.slice(0, 30)) {
        const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true });
        if (!msg || typeof msg === "boolean") continue;
        const env: any = msg.envelope ?? {};
        const from = (env.from ?? []).map((a: any) => `${a.name ?? ""} <${a.address ?? ""}>`).join(", ");
        const fromAddr = (env.from ?? []).map((a: any) => a.address ?? "").join(",").toLowerCase();
        // Solo procesamos emails de portales de empleo conocidos.
        if (!isJobAlertSender(fromAddr)) continue;
        let text = "";
        try {
          const { simpleParser } = await import("mailparser");
          const parsed = await simpleParser(msg.source as Buffer);
          text = (parsed.text || parsed.html || "").toString();
        } catch {
          text = (msg.source as Buffer)?.toString("utf8") ?? "";
        }
        const found = await extractOffers(workspaceId, { from, subject: env.subject ?? "", text });
        offers.push(...found);
        emails++;
        // Marca el email como leído para no reprocesarlo.
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => {});
      }
    } finally {
      lock.release();
    }
  } catch (e: any) {
    return { offers, emails, error: `IMAP: ${String(e?.message ?? e).slice(0, 180)}` };
  } finally {
    await client.logout().catch(() => {});
  }

  return { offers, emails, recovery: googleFailure ? "imap" : undefined };
}
