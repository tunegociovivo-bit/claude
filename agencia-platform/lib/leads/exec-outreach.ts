/**
 * Secuencia multicanal de contacto a un DIRECTIVO.
 *
 * Cadencia: email (auto, vía Resend) → LinkedIn (recordatorio) → llamada
 * (recordatorio) → email de cierre (auto). El motor avanza un paso por tick
 * respetando `nextAt`. Los pasos de email se envían solos (con pie de baja,
 * por cumplimiento LSSI/RGPD); los de LinkedIn/llamada crean una notificación
 * para que la persona actúe. Se detiene si el lead pasa a cliente/respondido.
 *
 * Se engancha al cron de leads, igual que la difusión y el auto-seguimiento.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { sendEmail, isEmailConfigured } from "@/lib/integrations/email";

type Channel = "email" | "linkedin" | "call";
/** Plan de cadencia: día relativo + canal. */
const STEPS: Array<{ day: number; channel: Channel }> = [
  { day: 0, channel: "email" },
  { day: 3, channel: "linkedin" },
  { day: 7, channel: "call" },
  { day: 11, channel: "email" }
];

export async function startExecOutreach(opts: {
  workspaceId: string;
  leadId: string;
  email?: string | null;
  directorName?: string | null;
  /** "review" redacta el email y lo deja para aprobación manual antes de enviar. */
  mode?: "auto" | "review";
}): Promise<{ id: string }> {
  const mode = opts.mode ?? "auto";
  const row = await prisma.leadExecOutreach.upsert({
    where: { workspaceId_leadId: { workspaceId: opts.workspaceId, leadId: opts.leadId } },
    create: {
      workspaceId: opts.workspaceId,
      leadId: opts.leadId,
      email: opts.email ?? null,
      directorName: opts.directorName ?? null,
      step: 0,
      status: "active",
      mode,
      nextAt: new Date(),
      log: []
    },
    update: { email: opts.email ?? undefined, directorName: opts.directorName ?? undefined, step: 0, status: "active", mode, draftSubject: null, draftBody: null, nextAt: new Date(), log: [] }
  });
  return { id: row.id };
}

/**
 * Redacta YA el email frío para una empresa de la fuente "jobs" y lo deja en la
 * cola de revisión (pending_review) sin esperar al cron. Así, en cuanto la
 * búsqueda termina, el usuario ve TODAS las ofertas con su borrador listo para
 * revisar, editar y elegir cuáles enviar. Si la redacción con IA falla, cae de
 * vuelta a una fila "active" en modo review para que el cron lo redacte luego.
 */
export async function draftJobsReview(opts: {
  workspaceId: string;
  leadId: string;
  email: string;
  company: string;
  sector?: string | null;
  jobTitle?: string | null;
  jobDescription?: string | null;
  /** Nombre del decisor (Apollo/Hunter) para dirigir el email por su nombre. */
  director?: string | null;
}): Promise<{ drafted: boolean }> {
  try {
    const mail = await writeEmail({
      workspaceId: opts.workspaceId,
      company: opts.company,
      sector: opts.sector,
      director: opts.director ?? null,
      touch: 1,
      jobTitle: opts.jobTitle ?? null,
      jobDescription: opts.jobDescription ?? null
    });
    await saveReviewDraft(opts.workspaceId, opts.leadId, opts.email, mail.subject, mail.body, opts.director ?? null);
    return { drafted: true };
  } catch {
    // Fallback: fila activa en modo review → el cron redactará en el próximo tick.
    await startExecOutreach({ workspaceId: opts.workspaceId, leadId: opts.leadId, email: opts.email, directorName: opts.director ?? null, mode: "review" });
    return { drafted: false };
  }
}

/**
 * Guarda un borrador de email en la cola de revisión (pending_review) con el
 * asunto y cuerpo dados. Genérico: lo usan tanto Empleos como Franquicias.
 */
export async function saveReviewDraft(workspaceId: string, leadId: string, email: string, subject: string, body: string, directorName?: string | null): Promise<void> {
  const now = new Date();
  const common = {
    email,
    step: 0,
    status: "pending_review",
    mode: "review" as const,
    draftSubject: subject,
    draftBody: body,
    // Guardamos el nombre del decisor para que "Regenerar" mantenga el saludo.
    ...(directorName ? { directorName } : {}),
    nextAt: now,
    log: [{ at: now.toISOString(), channel: "email_drafted", to: email, subject }]
  };
  await prisma.leadExecOutreach.upsert({
    where: { workspaceId_leadId: { workspaceId, leadId } },
    create: { workspaceId, leadId, ...common },
    update: common
  });
}

/**
 * Redacta borradores de revisión para TODAS las empresas de la fuente jobs que
 * tengan email y aún no tengan una secuencia (ni borrador) — botón "Generar
 * borradores" del panel Empleos. Cubre búsquedas antiguas o casos en los que el
 * borrado automático no llegó a crearse. No re-redacta lo ya descartado ni lo ya
 * pendiente. Acotado por `limit` para no disparar la latencia/coste.
 */
export async function generateJobsReviewDrafts(
  workspaceId: string,
  limit = 60
): Promise<{ drafted: number; candidates: number; alreadyHandled: number }> {
  let leads: { id: string; email: string | null; name: string; category: string | null; rawData: any }[] = [];
  try {
    leads = await prisma.lead.findMany({
      where: {
        workspaceId,
        email: { not: null },
        contactStatus: "pending",
        rawData: { path: ["source"], equals: "jobs" }
      },
      select: { id: true, email: true, name: true, category: true, rawData: true },
      take: 300
    });
  } catch {
    leads = [];
  }
  if (leads.length === 0) return { drafted: 0, candidates: 0, alreadyHandled: 0 };

  // Salta las empresas que ya tienen secuencia/borrador (o que se descartaron).
  const existing = await prisma.leadExecOutreach.findMany({
    where: { workspaceId, leadId: { in: leads.map((l) => l.id) } },
    select: { leadId: true }
  });
  const handled = new Set(existing.map((e) => e.leadId));
  const pending = leads.filter((l) => !handled.has(l.id)).slice(0, limit);

  let drafted = 0;
  const CHUNK = 5;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const slice = pending.slice(i, i + CHUNK);
    const res = await Promise.all(
      slice.map(async (l) => {
        const rd: any = l.rawData ?? {};
        const jobTitle = typeof rd?.jobTitle === "string" ? rd.jobTitle : null;
        const jobDescription = typeof rd?.jobDescription === "string" ? rd.jobDescription : null;
        try {
          await draftJobsReview({ workspaceId, leadId: l.id, email: l.email as string, company: l.name, sector: l.category, jobTitle, jobDescription });
          return true;
        } catch {
          return false;
        }
      })
    );
    drafted += res.filter(Boolean).length;
  }
  return { drafted, candidates: leads.length, alreadyHandled: handled.size };
}

/**
 * Franquicias — borradores de email bajo demanda (los leads de este origen NO
 * admiten WhatsApp). Recorre las centrales con email y sin contactar, redacta
 * el email (con el informe de red si el análisis lo dejó en rawData; si no,
 * versión sin cifras que ofrece el análisis gratuito) y lo deja en la MISMA
 * cola de revisión que Empleos (LeadExecOutreach pending_review): ahí se
 * edita, aprueba y envía. Dedupe: no toca leads con secuencia/borrador previo
 * (cualquier estado) ni con contactStatus distinto de "pending".
 */
export async function generateFranchiseReviewDrafts(
  workspaceId: string,
  limit = 60
): Promise<{ drafted: number; candidates: number; alreadyHandled: number; withoutEmail: number }> {
  const { writeFranchiseEmail } = await import("./sources/franchises");
  let leads: { id: string; email: string | null; name: string; category: string | null; rawData: any }[] = [];
  let withoutEmail = 0;
  try {
    const all = await prisma.lead.findMany({
      where: {
        workspaceId,
        contactStatus: "pending",
        rawData: { path: ["source"], equals: "franchises" }
      },
      select: { id: true, email: true, name: true, category: true, rawData: true },
      take: 300
    });
    withoutEmail = all.filter((l) => !l.email).length;
    leads = all.filter((l) => Boolean(l.email));
  } catch {
    leads = [];
  }
  if (leads.length === 0) return { drafted: 0, candidates: 0, alreadyHandled: 0, withoutEmail };

  const existing = await prisma.leadExecOutreach.findMany({
    where: { workspaceId, leadId: { in: leads.map((l) => l.id) } },
    select: { leadId: true }
  });
  const handled = new Set(existing.map((e) => e.leadId));
  const pending = leads.filter((l) => !handled.has(l.id)).slice(0, limit);

  let drafted = 0;
  const CHUNK = 5;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const slice = pending.slice(i, i + CHUNK);
    const res = await Promise.all(
      slice.map(async (l) => {
        const rd: any = l.rawData ?? {};
        const brand = typeof rd?.brand === "string" && rd.brand.trim() ? rd.brand : l.name;
        const report = typeof rd?.reportText === "string" && rd.reportText.trim() ? rd.reportText : null;
        const director = typeof rd?.directorName === "string" ? rd.directorName : null;
        const role = typeof rd?.directorRole === "string" ? rd.directorRole : null;
        const sector = typeof rd?.sector === "string" ? rd.sector : l.category;
        try {
          const mail = await writeFranchiseEmail(
            workspaceId,
            brand,
            report,
            { email: null, name: director, role, linkedin: null },
            sector
          );
          await saveReviewDraft(workspaceId, l.id, l.email as string, mail.subject, mail.body, director);
          return true;
        } catch {
          return false;
        }
      })
    );
    drafted += res.filter(Boolean).length;
  }
  return { drafted, candidates: leads.length, alreadyHandled: handled.size, withoutEmail };
}

export async function stopExecOutreach(workspaceId: string, leadId: string): Promise<void> {
  await prisma.leadExecOutreach.updateMany({
    where: { workspaceId, leadId, status: "active" },
    data: { status: "stopped" }
  });
}

const EMAIL_SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"]
};

const EMAIL_SYSTEM = `Eres un consultor de Negocio Vivo, una AGENCIA de marketing digital, que escribe a un
DIRECTIVO para ofrecer sus servicios. Redacta un EMAIL frío B2B:
- IDIOMA: redacta el email (asunto y cuerpo) en el MISMO idioma en que esté escrita la OFERTA de empleo
  del contexto. Si la oferta está en inglés → email en inglés; si en español → español de España; etc.
  Si no hay pistas de idioma, usa español de España. Trato formal y consistente (usted en español; el
  registro formal equivalente en el idioma que toque). Asunto corto y concreto (sin clickbait).
- Cuerpo de 5-7 líneas: motivo concreto (oportunidad/problema de su sector o su vacante), la propuesta
  de valor y un cierre con una llamada de 10 min. Nada de adjuntos ni promesas vacías.
- DIFERENCIADOR CLAVE (inclúyelo SIEMPRE, redactado con naturalidad y elegancia, integrado en el
  discurso, NO como lista ni de forma grandilocuente): deja claro que contratar a Negocio Vivo NO es
  lo mismo que contratar a una sola persona. Somos una agencia con infraestructura detrás: herramientas
  especializadas para cada tarea de marketing digital con las que conseguimos resultados excelentes, y
  un equipo propio de IA para analítica, para la toma de decisiones en campañas de pago y para implantar
  sistemas que mejoran sus procesos y les facilitan el trabajo del día a día. La idea a transmitir: por
  el coste (o menos) de un empleado, obtienen un equipo y una tecnología que una sola persona no puede dar.
- No inventes datos, cifras, clientes ni precios concretos. Devuelve SOLO el JSON {subject, body}.`;

/**
 * Detecta si la oferta está en inglés o en español (heurística por palabras
 * función, que son las que mejor distinguen idioma). Se usa para forzar el
 * idioma del email — más fiable que dejar que el modelo lo infiera de un prompt
 * mayormente en español. Ante la duda, español.
 */
export function detectOfferLang(text: string): "en" | "es" {
  const t = " " + (text || "").toLowerCase().replace(/[^a-záéíóúñ&\s]/gi, " ") + " ";
  const en = (t.match(/\b(the|and|you|your|we|our|for|with|of|to|will|are|is|be|as|at|role|team|content|social|media|skills?|experience|about|what|looking|join|head|lead|manager|officer|marketing|growth|senior|junior)\b/g) || []).length;
  const es = (t.match(/\b(de|que|para|el|la|los|las|con|y|un|una|en|por|del|se|su|sus|buscamos|empresa|puesto|experiencia|equipo|trabajo|contenidos?|responsable|gesti[oó]n|conocimientos?)\b/g) || []).length;
  if (es === 0 && en >= 1) return "en";
  if (en > es * 1.5 && en >= 2) return "en";
  return "es";
}

async function writeEmail(opts: { workspaceId: string; company: string; sector?: string | null; director?: string | null; touch: number; jobTitle?: string | null; jobDescription?: string | null }): Promise<{ subject: string; body: string }> {
  const ctx = [
    `Empresa: ${opts.company}`,
    opts.sector ? `Sector: ${opts.sector}` : null,
    opts.jobTitle
      ? `IMPORTANTE: la empresa tiene AHORA MISMO una oferta de empleo abierta para el puesto "${opts.jobTitle}". Enfoca el email en esa vacante: menciónala con naturalidad y ofrece que Negocio Vivo cubra esa función de marketing/IA como servicio externo (resultados desde el primer mes, sin coste de contratación, alta laboral ni formación). Contrasta con tacto que, en lugar de fichar a UNA sola persona para ese puesto, con la agencia tienen detrás un equipo con herramientas e IA especializadas. Tono de ayuda, sin presionar ni criticar que contraten.`
      : null,
    opts.jobDescription
      ? `Contexto de la oferta (úsalo para personalizar SIN copiarlo literal ni inventar nada que no aparezca): «${opts.jobDescription.slice(0, 600)}»`
      : null,
    opts.director
      ? `Destinatario: ${opts.director} (responsable de marketing). DIRÍGETE A ÉL/ELLA POR SU NOMBRE en el saludo (p. ej. "Estimado/a ${opts.director.split(/\s+/)[0]}," en español, o "Hi ${opts.director.split(/\s+/)[0]}," / "Dear ${opts.director.split(/\s+/)[0]}," en inglés). Usa solo el nombre de pila, no el apellido.`
      : "Destinatario: máximo responsable (saludo genérico, sin nombre).",
    opts.touch > 1 ? `Es un email de SEGUIMIENTO (toque ${opts.touch}); cambia el enfoque y sé aún más breve.` : null
  ]
    .filter(Boolean)
    .join("\n");
  // Idioma FORZADO según la oferta (título + descripción). Es una orden explícita
  // porque el resto del prompt va en español y, si no, el modelo tira a español.
  const lang = detectOfferLang(`${opts.jobTitle ?? ""}. ${opts.jobDescription ?? ""}`);
  const langDirective =
    lang === "en"
      ? "IDIOMA OBLIGATORIO: la oferta está en INGLÉS → escribe TODO el email (subject y body) EN INGLÉS, con registro profesional. No uses español."
      : "IDIOMA OBLIGATORIO: escribe TODO el email (asunto y cuerpo) en ESPAÑOL de España.";
  return completeJson<{ subject: string; body: string }>({
    workspaceId: opts.workspaceId,
    model: "claude-haiku-4-5-20251001",
    system: EMAIL_SYSTEM,
    user: `${langDirective}\n\n${ctx}\n\nEscribe el email:`,
    schema: EMAIL_SCHEMA,
    maxTokens: 650
  });
}

function emailHtml(body: string): string {
  const paras = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">${paras}
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
    <p style="font-size:11px;color:#888;margin:0">Si no desea recibir más comunicaciones comerciales, responda <strong>BAJA</strong> a este correo y le retiraremos de inmediato (RGPD/LSSI).</p>
  </div>`;
}

async function notifyAdmins(workspaceId: string, body: string, link: string, tag: string): Promise<void> {
  const admins = await prisma.membership.findMany({ where: { workspaceId, role: "ADMIN" }, select: { userId: true } });
  if (admins.length === 0) return;
  await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.userId, type: "exec_outreach", body, link })) });
  try {
    const { sendPushToUser } = await import("@/lib/push/web-push");
    await Promise.all(admins.map((a) => sendPushToUser(a.userId, { title: "Secuencia directivo", body, link, tag }).catch(() => {})));
  } catch {}
}

export async function processExecOutreachTick(workspaceId: string): Promise<{ processed: boolean; leadId?: string; channel?: string; error?: string }> {
  const now = new Date();
  const row = await prisma.leadExecOutreach.findFirst({
    where: { workspaceId, status: "active", nextAt: { lte: now } },
    orderBy: { nextAt: "asc" }
  });
  if (!row) return { processed: false };

  const lead = await prisma.lead.findFirst({
    where: { id: row.leadId, workspaceId },
    select: { name: true, category: true, contactStatus: true, phone: true, internationalPhone: true, rawData: true }
  });
  // Si el lead ya avanzó en el funnel O está EXCLUIDO (opt-out / bloqueo), paramos.
  if (!lead || ["client", "responded", "discarded", "excluded"].includes(lead.contactStatus)) {
    await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "stopped" } });
    return { processed: false, error: lead?.contactStatus === "excluded" ? "lead_blocked" : "lead_advanced" };
  }
  // Veto por teléfono: si alguno de sus números está en opt-out, no contactar.
  const { normalizePhone } = await import("./waha");
  const phones = [lead.internationalPhone, lead.phone]
    .map((p) => normalizePhone(p))
    .filter(Boolean) as string[];
  if (phones.length) {
    const veto = await prisma.leadOptout.findFirst({
      where: { workspaceId, phone: { in: phones } },
      select: { id: true }
    });
    if (veto) {
      await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "stopped" } });
      return { processed: false, error: "recipient_opted_out" };
    }
  }

  const stepDef = STEPS[row.step];
  if (!stepDef) {
    await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "done" } });
    return { processed: false, error: "no_step" };
  }

  const link = `/admin/leads?lead=${row.leadId}`;
  const log: any[] = Array.isArray(row.log) ? row.log : [];
  let channelDone = stepDef.channel as string;

  try {
    if (stepDef.channel === "email") {
      const emailTouch = STEPS.slice(0, row.step + 1).filter((s) => s.channel === "email").length;
      // Ángulo "vacante": si el lead viene de la fuente jobs, mencionamos el
      // puesto abierto para ofrecerlo como servicio externo.
      const rd: any = lead.rawData ?? {};
      const jobTitle = rd?.source === "jobs" && typeof rd?.jobTitle === "string" ? rd.jobTitle : null;
      const jobDescription = rd?.source === "jobs" && typeof rd?.jobDescription === "string" ? rd.jobDescription : null;
      // Modo REVISIÓN: redacta el email y lo deja pendiente de aprobación. No
      // envía ni avanza de paso; espera a que un admin lo apruebe (o descarte).
      const emailOk = await isEmailConfigured(workspaceId); // env O bóveda del workspace
      if (row.mode === "review" && row.email && emailOk) {
        const mail = await writeEmail({ workspaceId, company: lead.name, sector: lead.category, director: row.directorName, touch: emailTouch, jobTitle, jobDescription });
        log.push({ at: now.toISOString(), channel: "email_drafted", to: row.email, subject: mail.subject });
        await prisma.leadExecOutreach.update({
          where: { id: row.id },
          data: { status: "pending_review", draftSubject: mail.subject, draftBody: mail.body, log }
        });
        await notifyAdmins(workspaceId, `📝 Email listo para revisar: ${lead.name}${row.email ? ` (${row.email})` : ""}. Apruébalo para enviarlo.`, "/admin/leads?tab=jobs-review", `exec-review-${row.id}`);
        return { processed: true, leadId: row.leadId, channel: "email_review" };
      }
      if (row.email && emailOk) {
        const mail = await writeEmail({ workspaceId, company: lead.name, sector: lead.category, director: row.directorName, touch: emailTouch, jobTitle, jobDescription });
        const bcc = Array.isArray(rd?.bccEmails) ? (rd.bccEmails as string[]) : undefined;
        const out = await sendEmail({ to: row.email, subject: mail.subject, html: emailHtml(mail.body), text: mail.body, bcc, workspaceId });
        log.push({ at: now.toISOString(), channel: "email", to: row.email, subject: mail.subject, id: out.id, bcc: bcc?.length ?? 0 });
      } else {
        // Sin email destino o sin Resend → recordatorio manual.
        channelDone = "email_manual";
        await notifyAdmins(workspaceId, `📨 Envía tú el email a ${row.directorName ?? lead.name}${row.email ? ` (${row.email})` : " (falta email)"}.`, link, `exec-${row.id}-${row.step}`);
        log.push({ at: now.toISOString(), channel: "email_manual", reason: row.email ? "resend_off" : "no_email" });
      }
    } else if (stepDef.channel === "linkedin") {
      await notifyAdmins(workspaceId, `🔗 Hoy toca LinkedIn: contacta a ${row.directorName ?? "el responsable"} de ${lead.name}.`, link, `exec-${row.id}-${row.step}`);
      log.push({ at: now.toISOString(), channel: "linkedin" });
    } else {
      await notifyAdmins(workspaceId, `📞 Hoy toca llamar a ${lead.name}${row.directorName ? ` (${row.directorName})` : ""}.`, link, `exec-${row.id}-${row.step}`);
      log.push({ at: now.toISOString(), channel: "call" });
    }
  } catch (e: any) {
    return { processed: false, error: `step_failed: ${e?.message ?? e}` };
  }

  // Avanza al siguiente paso (o finaliza).
  const next = row.step + 1;
  if (next >= STEPS.length) {
    await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "done", step: next, log } });
  } else {
    const deltaDays = STEPS[next].day - STEPS[row.step].day;
    await prisma.leadExecOutreach.update({
      where: { id: row.id },
      data: { step: next, nextAt: new Date(now.getTime() + Math.max(1, deltaDays) * 86_400_000), log }
    });
  }
  return { processed: true, leadId: row.leadId, channel: channelDone };
}

/** Un email pendiente de revisión (modo review), con el borrador y el contexto. */
export type PendingReviewItem = {
  id: string;
  leadId: string;
  email: string | null;
  subject: string | null;
  body: string | null;
  company: string;
  category: string | null;
  website: string | null;
  phone: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  jobDescription: string | null;
  directorName: string | null;
  directorRole: string | null;
  linkedin: string | null;
  /** Emails de otros directivos de marketing que irán en copia oculta. */
  bccEmails: string[];
  createdAt: string;
};

/** Lista los emails redactados que esperan aprobación manual en el workspace. */
export async function listPendingReview(workspaceId: string): Promise<PendingReviewItem[]> {
  const rows = await prisma.leadExecOutreach.findMany({
    where: { workspaceId, status: "pending_review" },
    orderBy: { updatedAt: "asc" },
    take: 200,
    select: {
      id: true,
      leadId: true,
      email: true,
      draftSubject: true,
      draftBody: true,
      updatedAt: true,
      lead: { select: { name: true, category: true, website: true, phone: true, rawData: true } }
    }
  });
  return rows.map((r) => {
    const rd: any = r.lead?.rawData ?? {};
    return {
      id: r.id,
      leadId: r.leadId,
      email: r.email,
      subject: r.draftSubject,
      body: r.draftBody,
      company: r.lead?.name ?? "",
      category: r.lead?.category ?? null,
      website: r.lead?.website ?? null,
      phone: r.lead?.phone ?? null,
      jobTitle: typeof rd?.jobTitle === "string" ? rd.jobTitle : null,
      jobUrl: typeof rd?.jobUrl === "string" ? rd.jobUrl : null,
      jobDescription: typeof rd?.jobDescription === "string" ? rd.jobDescription : null,
      bccEmails: Array.isArray(rd?.bccEmails) ? rd.bccEmails.filter((x: any) => typeof x === "string") : [],
      directorName: typeof rd?.directorName === "string" ? rd.directorName : null,
      directorRole: typeof rd?.directorRole === "string" ? rd.directorRole : null,
      linkedin: typeof rd?.linkedin === "string" ? rd.linkedin : null,
      createdAt: r.updatedAt.toISOString()
    };
  });
}

/**
 * Aprueba un email pendiente: lo envía (con el texto editado si se pasa),
 * marca el lead como contactado y avanza la secuencia al siguiente paso.
 */
export async function approveExecOutreach(
  workspaceId: string,
  id: string,
  edit?: { subject?: string; body?: string }
): Promise<{ sent: boolean }> {
  const row = await prisma.leadExecOutreach.findFirst({ where: { id, workspaceId, status: "pending_review" } });
  if (!row) throw new Error("No hay un email pendiente de revisión con ese id.");
  if (!row.email) throw new Error("Este contacto no tiene email destinatario.");
  if (!(await isEmailConfigured(workspaceId))) throw new Error("El envío de email no está configurado (falta RESEND_API_KEY en Railway o la clave de Resend en /admin/secretos).");
  const subject = (edit?.subject ?? row.draftSubject ?? "").trim();
  const body = (edit?.body ?? row.draftBody ?? "").trim();
  if (!subject || !body) throw new Error("El borrador del email está vacío.");

  // Copia oculta a todos los directivos de marketing localizados (si los hay).
  const leadRd = await prisma.lead.findFirst({ where: { id: row.leadId, workspaceId }, select: { rawData: true } });
  const bcc = Array.isArray((leadRd?.rawData as any)?.bccEmails) ? ((leadRd!.rawData as any).bccEmails as string[]) : undefined;

  const out = await sendEmail({ to: row.email, subject, html: emailHtml(body), text: body, bcc, workspaceId });
  const now = new Date();
  const log: any[] = Array.isArray(row.log) ? row.log : [];
  log.push({ at: now.toISOString(), channel: "email", to: row.email, subject, id: out.id, approved: true, bcc: bcc?.length ?? 0 });

  // Marca el lead como contactado (sin degradar estados más avanzados).
  await prisma.lead.updateMany({
    where: { id: row.leadId, workspaceId, contactStatus: { notIn: ["client", "responded", "discarded", "excluded"] } },
    data: { contactStatus: "contacted" }
  });

  // Avanza la secuencia igual que tras un envío automático.
  const next = row.step + 1;
  if (next >= STEPS.length) {
    await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "done", step: next, draftSubject: null, draftBody: null, log } });
  } else {
    const deltaDays = STEPS[next].day - STEPS[row.step].day;
    await prisma.leadExecOutreach.update({
      where: { id: row.id },
      data: { status: "active", step: next, nextAt: new Date(now.getTime() + Math.max(1, deltaDays) * 86_400_000), draftSubject: null, draftBody: null, log }
    });
  }
  return { sent: true };
}

/**
 * Vuelve a redactar con IA el borrador de un email en revisión (mismo lead), para
 * aplicar cambios de mensaje/discurso a los borradores ya creados. Actualiza el
 * borrador guardado y lo devuelve.
 */
export async function regenerateReviewDraft(workspaceId: string, id: string): Promise<{ subject: string; body: string }> {
  const row = await prisma.leadExecOutreach.findFirst({ where: { id, workspaceId, status: "pending_review" } });
  if (!row) throw new Error("No hay un email pendiente de revisión con ese id.");
  const lead = await prisma.lead.findFirst({
    where: { id: row.leadId, workspaceId },
    select: { name: true, category: true, rawData: true }
  });
  if (!lead) throw new Error("Lead no encontrado.");
  const rd: any = lead.rawData ?? {};
  const jobTitle = typeof rd?.jobTitle === "string" ? rd.jobTitle : null;
  const jobDescription = typeof rd?.jobDescription === "string" ? rd.jobDescription : null;
  // Decisor: el de la fila, o (borradores antiguos) el capturado en rawData.
  const director = row.directorName ?? (typeof rd?.directorName === "string" ? rd.directorName : null);
  const mail = await writeEmail({
    workspaceId,
    company: lead.name,
    sector: lead.category,
    director,
    touch: 1,
    jobTitle,
    jobDescription
  });
  await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { draftSubject: mail.subject, draftBody: mail.body } });
  return mail;
}

/** Descarta un email pendiente de revisión y detiene su secuencia. */
export async function rejectExecOutreach(workspaceId: string, id: string): Promise<void> {
  await prisma.leadExecOutreach.updateMany({
    where: { id, workspaceId, status: "pending_review" },
    data: { status: "stopped", draftSubject: null, draftBody: null }
  });
}
