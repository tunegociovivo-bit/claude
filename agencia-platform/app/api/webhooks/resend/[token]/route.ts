import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { classifyResendFailure, isAutomaticEmailReply, resendFailureRetryAt, verifyResendWebhook } from "@/lib/leads/resend-webhook";
import { finishProspectIfDone, markLeadEmailOpened, markLeadHumanReply } from "@/lib/leads/lead-cadence";
import { recordLeadContactEvent } from "@/lib/leads/contact-events";
import { addSuppression } from "@/lib/leads/suppressions";
import { blockLeadCompletely } from "@/lib/leads/optout";
import { forwardResendReceivedEmail, retrieveResendReceivedEmail, retrieveResendSentEmail } from "@/lib/integrations/email";
import { normalizeEmail } from "@/lib/leads/email-verification";
import { triggerNvIaFromInbound } from "@/lib/ai/nv-ia/inbound-trigger";
import { isPermanentNoContactReply } from "@/lib/leads/reply-classification";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const endpointToken = process.env.RESEND_WEBHOOK_TOKEN;
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!endpointToken || params.token !== endpointToken || !secret) {
    return NextResponse.json({ ok: false, error: "not_configured_or_unauthorized" }, { status: 401 });
  }
  const rawBody = await req.text();
  const eventId = req.headers.get("svix-id") ?? req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp") ?? "";
  const signature = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature") ?? "";
  if (!verifyResendWebhook({ rawBody, id: eventId, timestamp, signature, secret })) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const type = String(payload.type ?? "");
  const emailId = String(payload.data?.email_id ?? payload.data?.emailId ?? payload.data?.id ?? "");
  if (!emailId) return NextResponse.json({ ok: true, matched: false });
  if (type === "email.received") {
    return handleReceivedEmail({ payload, emailId, eventId, occurredAt: payload.created_at ? new Date(payload.created_at) : new Date() });
  }
  const taggedActivityId = eventTag(payload.data, "activity");
  const taggedAttemptValue = eventTag(payload.data, "provider_attempt");
  const taggedAttempt = taggedAttemptValue === null ? null : Number(taggedAttemptValue);
  let activity = await prisma.prospectingActivity.findFirst({
    where: { externalId: emailId },
    include: { prospect: true }
  });
  if (activity && taggedActivityId) {
    const currentAttempt = Number((activity.payload as any)?.providerAttempt ?? 0);
    if (taggedActivityId !== activity.id || (taggedAttempt !== null && taggedAttempt !== currentAttempt)) {
      return NextResponse.json({ ok: true, matched: true, staleAttempt: true });
    }
  }
  if (!activity) {
    if (taggedActivityId) {
      const candidate = await prisma.prospectingActivity.findFirst({
        where: { id: taggedActivityId },
        include: { prospect: true }
      });
      const currentAttempt = Number((candidate?.payload as any)?.providerAttempt ?? 0);
      if (candidate && taggedAttempt !== null && taggedAttempt === currentAttempt) {
        const mapped = await prisma.prospectingActivity.updateMany({
          where: {
            id: candidate.id,
            workspaceId: candidate.workspaceId,
            OR: [{ externalId: null }, { externalId: emailId }],
            payload: { path: ["providerAttempt"], equals: taggedAttempt }
          },
          data: { externalId: emailId }
        });
        if (mapped.count) activity = candidate;
      } else if (candidate && taggedAttempt !== null && taggedAttempt !== currentAttempt) {
        return NextResponse.json({ ok: true, matched: true, staleAttempt: true });
      }
    }
  }
  if (!activity?.prospect?.leadId) {
    const knownMessage = await prisma.prospectingMessage.findFirst({
      where: { channel: "email", externalId: emailId },
      select: { id: true }
    });
    if (knownMessage) return NextResponse.json({ ok: true, matched: true, duplicate: true });
    // Resend puede emitir el webhook inmediatamente después de aceptar el
    // envío, antes de que terminemos de persistir su ID. Solo pedimos retry a
    // eventos etiquetados por este módulo; los demás emails del relay no se
    // quedan reintentando contra un handler que no les pertenece.
    if (eventTag(payload.data, "module") === "nv_leads_pro") {
      return NextResponse.json(
        { ok: false, matched: false, retry: true },
        { status: 503, headers: { "Retry-After": "3" } }
      );
    }
    return NextResponse.json({ ok: true, matched: false });
  }
  const lead = await prisma.lead.findFirst({ where: { id: activity.prospect.leadId, workspaceId: activity.workspaceId } });
  if (!lead) return NextResponse.json({ ok: true, matched: false });
  const providerEventId = `${eventId}:${type}`;
  const occurredAt = payload.created_at ? new Date(payload.created_at) : new Date();

  if (type === "email.sent") {
    const sent = await retrieveResendSentEmail(activity.workspaceId, emailId, { globalConfigOnly: true }).catch(() => null);
    if (sent?.message_id) {
      const message = await prisma.prospectingMessage.findFirst({ where: { workspaceId: activity.workspaceId, channel: "email", externalId: emailId } });
      if (message) {
        await prisma.prospectingMessage.update({
          where: { id: message.id },
          data: {
            rfcMessageId: normalizeRfcMessageId(String(sent.message_id)),
            metadata: { ...((message.metadata as any) ?? {}), rfcMessageId: String(sent.message_id) }
          }
        });
      }
    }
  }

  if (type === "email.opened" || type === "email.clicked") {
    await markLeadEmailOpened({ workspaceId: activity.workspaceId, leadId: lead.id, prospectId: activity.prospect.id, externalMessageId: emailId, providerEventId, occurredAt });
  } else if (type === "email.complained") {
    await recordLeadContactEvent({ workspaceId: activity.workspaceId, leadId: lead.id, prospectId: activity.prospect.id, channel: "email", type: "complained", provider: "resend", providerEventId, externalMessageId: emailId, occurredAt, metadata: payload.data });
    await blockLeadCompletely({ workspaceId: activity.workspaceId, leadId: lead.id, email: eventRecipient(payload.data) ?? activity.prospect.email, reason: "Queja de spam recibida por Resend", source: "resend_complaint" });
  } else if (type === "email.bounced") {
    await recordLeadContactEvent({ workspaceId: activity.workspaceId, leadId: lead.id, prospectId: activity.prospect.id, channel: "email", type: "bounced", provider: "resend", providerEventId, externalMessageId: emailId, occurredAt, metadata: payload.data });
    const bouncedEmail = eventRecipient(payload.data) ?? normalizeEmail(activity.prospect.email);
    if (bouncedEmail) await addSuppression({ workspaceId: activity.workspaceId, leadId: lead.id, kind: "email", value: bouncedEmail, reason: "Rebote de email", source: "resend_bounce" });
    if (bouncedEmail && normalizeEmail(lead.email) === bouncedEmail) {
      await prisma.lead.update({ where: { id: lead.id }, data: { emailVerificationStatus: "invalid" } });
    }
    await prisma.prospectingActivity.updateMany({ where: { prospectId: activity.prospect.id, channel: "email", status: { in: ["queued", "processing"] } }, data: { status: "skipped", executedAt: occurredAt, leaseUntil: null, error: "Email bloqueado tras rebote" } });
    await finishProspectIfDone(activity.prospect.id);
  } else if (type === "email.suppressed") {
    await recordLeadContactEvent({ workspaceId: activity.workspaceId, leadId: lead.id, prospectId: activity.prospect.id, channel: "email", type: "suppressed", provider: "resend", providerEventId, externalMessageId: emailId, occurredAt, metadata: payload.data });
    const suppressedEmail = eventRecipient(payload.data) ?? normalizeEmail(activity.prospect.email);
    const reasonText = String(payload.data?.suppressed?.message ?? payload.data?.suppressed?.type ?? "OnAccountSuppressionList");
    if (suppressedEmail) {
      await addSuppression({ workspaceId: activity.workspaceId, leadId: lead.id, kind: "email", value: suppressedEmail, reason: `Supresión de Resend: ${reasonText}`, source: "resend_suppressed" });
    }
    await prisma.prospectingActivity.updateMany({
      where: { prospectId: activity.prospect.id, channel: "email", status: { in: ["queued", "processing"] } },
      data: { status: "skipped", executedAt: occurredAt, leaseUntil: null, error: "Email bloqueado por la lista de supresión de Resend" }
    });
    await finishProspectIfDone(activity.prospect.id);
  } else if (type === "email.failed") {
    await recordLeadContactEvent({ workspaceId: activity.workspaceId, leadId: lead.id, prospectId: activity.prospect.id, channel: "email", type: "failed", provider: "resend", providerEventId, externalMessageId: emailId, occurredAt, metadata: payload.data });
    await prisma.prospectingMessage.updateMany({
      where: { workspaceId: activity.workspaceId, channel: "email", externalId: emailId },
      data: { status: "failed" }
    });
    const reasonText = String(payload.data?.failed?.reason ?? payload.data?.failed?.message ?? "Fallo de entrega de Resend");
    const failureKind = classifyResendFailure(reasonText);
    const providerAttempt = Math.max(0, Number((activity.payload as any)?.providerAttempt ?? 0));
    if (failureKind === "invalid_recipient") {
      const invalidEmail = eventRecipient(payload.data) ?? normalizeEmail(activity.prospect.email);
      if (invalidEmail) {
        await addSuppression({ workspaceId: activity.workspaceId, leadId: lead.id, kind: "email", value: invalidEmail, reason: `Destinatario inválido en Resend: ${reasonText}`, source: "resend_failed" });
        if (normalizeEmail(lead.email) === invalidEmail) {
          await prisma.lead.updateMany({
            where: { id: lead.id, workspaceId: activity.workspaceId },
            data: { emailVerificationStatus: "invalid" }
          });
        }
      }
      await prisma.prospectingActivity.updateMany({
        where: { id: activity.id, workspaceId: activity.workspaceId },
        data: { status: "failed", executedAt: occurredAt, leaseUntil: null, error: `Destinatario inválido: ${reasonText}` }
      });
      await prisma.prospectingActivity.updateMany({
        where: { prospectId: activity.prospect.id, workspaceId: activity.workspaceId, channel: "email", id: { not: activity.id }, status: { in: ["queued", "processing"] } },
        data: { status: "skipped", executedAt: occurredAt, leaseUntil: null, error: "Email bloqueado tras destinatario inválido" }
      });
      await finishProspectIfDone(activity.prospect.id);
    } else if (failureKind === "quota") {
      await prisma.prospectingActivity.updateMany({
        where: { id: activity.id, workspaceId: activity.workspaceId },
        data: {
          status: "queued",
          scheduledAt: resendFailureRetryAt(reasonText, occurredAt),
          executedAt: null,
          externalId: null,
          leaseUntil: null,
          error: `Aplazado por cuota de Resend: ${reasonText}`,
          payload: { ...((activity.payload as any) ?? {}), providerAttempt: providerAttempt + 1 }
        }
      });
    } else if (failureKind === "configuration") {
      await prisma.prospectingCampaign.updateMany({
        where: { id: activity.campaignId, workspaceId: activity.workspaceId },
        data: { status: "paused", complianceMode: "review" }
      });
      await prisma.prospectingActivity.updateMany({
        where: { id: activity.id, workspaceId: activity.workspaceId },
        data: {
          status: "queued",
          scheduledAt: new Date(occurredAt.getTime() + 60 * 60_000),
          executedAt: null,
          externalId: null,
          leaseUntil: null,
          error: `Campaña pausada por configuración de Resend: ${reasonText}`,
          payload: { ...((activity.payload as any) ?? {}), providerAttempt: providerAttempt + 1 }
        }
      });
    } else {
      if (providerAttempt >= 2) {
        await prisma.prospectingActivity.updateMany({
          where: { id: activity.id, workspaceId: activity.workspaceId },
          data: { status: "failed", executedAt: occurredAt, leaseUntil: null, error: `Resend agotó reintentos: ${reasonText}` }
        });
        await finishProspectIfDone(activity.prospect.id);
      } else {
        await prisma.prospectingActivity.updateMany({
          where: { id: activity.id, workspaceId: activity.workspaceId },
          data: {
            status: "queued",
            scheduledAt: new Date(occurredAt.getTime() + (providerAttempt + 1) * 15 * 60_000),
            executedAt: null,
            externalId: null,
            leaseUntil: null,
            error: `Reintento tras fallo de Resend: ${reasonText}`,
            payload: { ...((activity.payload as any) ?? {}), providerAttempt: providerAttempt + 1 }
          }
        });
      }
    }
  } else {
    await recordLeadContactEvent({ workspaceId: activity.workspaceId, leadId: lead.id, prospectId: activity.prospect.id, channel: "email", type: type.replace(/^email\./, "") || "event", provider: "resend", providerEventId, externalMessageId: emailId, occurredAt, metadata: payload.data });
  }
  return NextResponse.json({ ok: true, matched: true });
}

async function handleReceivedEmail(opts: { payload: any; emailId: string; eventId: string; occurredAt: Date }) {
  const recipients = [...(Array.isArray(opts.payload.data?.to) ? opts.payload.data.to : []), ...(Array.isArray(opts.payload.data?.received_for) ? opts.payload.data.received_for : [])]
    .map((value) => normalizeEmail(String(value).match(/[\w.+-]+@[\w.-]+/)?.[0]))
    .filter((value): value is string => !!value);
  const inboundAddress = normalizeEmail(process.env.LEADS_INBOUND_ADDRESS ?? "info@ia.negociovivo.app");
  const forwardTo = normalizeEmail(process.env.LEADS_INBOUND_FORWARD_TO ?? "info@negociovivo.com");
  if (inboundAddress && forwardTo && recipients.includes(inboundAddress)) {
    await forwardResendReceivedEmail({
      emailId: opts.emailId,
      from: `Negocio Vivo <${inboundAddress}>`,
      to: forwardTo,
      idempotencyKey: `nv-inbound-forward:${opts.eventId || opts.emailId}`,
      globalConfigOnly: true
    });
  }
  const campaigns = await prisma.prospectingCampaign.findMany({
    where: { kind: "gmb_multichannel", replyTo: { not: null } },
    select: { id: true, workspaceId: true, replyTo: true }
  });
  const candidates = campaigns.filter((candidate) => {
    const address = normalizeEmail(candidate.replyTo);
    return !!address && recipients.includes(address);
  });
  if (!candidates.length) return NextResponse.json({ ok: true, matched: false });

  // La automatización GMB comparte la cuenta Resend global vinculada a este
  // secret. El tenant se elige después por Message-ID RFC, nunca por el primer
  // Reply-To candidato.
  const received = await retrieveResendReceivedEmail(candidates[0].workspaceId, opts.emailId, { globalConfigOnly: true })
    .catch(() => null);
  if (!received) throw new Error("No se pudo recuperar el email entrante desde la cuenta Resend del webhook");
  const fromEmail = normalizeEmail(String(received.from ?? opts.payload.data?.from ?? "").match(/[\w.+-]+@[\w.-]+/)?.[0]);
  if (!fromEmail) return NextResponse.json({ ok: true, matched: false });
  const subject = String(received.subject ?? opts.payload.data?.subject ?? "");
  const text = String(received.text ?? stripHtml(String(received.html ?? ""))).slice(0, 100_000).trim();
  if (!text) throw new Error("Resend no devolvió el cuerpo del email recibido");

  const replyHeaders = `${headerValue(received.headers, "in-reply-to")} ${headerValue(received.headers, "references")}`.trim();
  const replyMessageIds = new Set(messageIdTokens(replyHeaders));
  let matching = replyMessageIds.size ? await prisma.prospectingMessage.findMany({
    where: {
      campaignId: { in: candidates.map((campaign) => campaign.id) },
      channel: "email",
      direction: "out",
      rfcMessageId: { in: [...replyMessageIds] }
    },
    include: { prospect: true },
    orderBy: { createdAt: "desc" }
  }) : [];
  if (!matching.length) {
    const normalizedSubject = replySubject(subject);
    const fallback = await prisma.prospectingMessage.findMany({
      where: {
        campaignId: { in: candidates.map((campaign) => campaign.id) },
        channel: "email",
        direction: "out",
        createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
        prospect: { email: { equals: fromEmail, mode: "insensitive" } }
      },
      include: { prospect: true },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    matching = fallback.filter((message) =>
      !!normalizedSubject && normalizedSubject === replySubject(String((message.metadata as any)?.subject ?? ""))
    );
  }
  const targets = new Map(matching
    .filter((message) => !!message.prospect.leadId)
    .map((message) => [`${message.workspaceId}:${message.prospect.id}`, message] as const));
  if (targets.size !== 1) return NextResponse.json({ ok: true, matched: false });
  const matchedMessage = [...targets.values()][0];
  const campaign = candidates.find((candidate) => candidate.id === matchedMessage.campaignId);
  const leadId = matchedMessage.prospect.leadId;
  if (!campaign || !leadId) return NextResponse.json({ ok: true, matched: false });
  const prospect = matchedMessage.prospect;
  const freshText = unquotedReply(text);
  const normalizedText = `${subject}\n${freshText}`.toLowerCase();
  const automatic = isAutomaticEmailReply({ subject, text: freshText, headers: received.headers });
  const rejection = isPermanentNoContactReply(normalizedText);
  await prisma.prospectingMessage.create({
    data: { workspaceId: campaign.workspaceId, campaignId: campaign.id, prospectId: prospect.id, channel: "email", direction: "in", body: freshText.slice(0, 16000), status: "received", externalId: opts.emailId, rfcMessageId: normalizeRfcMessageId(String(received.message_id ?? "")), classification: automatic ? "auto_reply" : rejection ? "opt_out" : "human_reply", metadata: { from: received.from, subject, rfcMessageId: received.message_id } }
  }).catch(() => null);
  if (automatic) {
    await prisma.prospectingProspect.update({ where: { id: prospect.id }, data: { autoReplyAt: opts.occurredAt } });
    await recordLeadContactEvent({ workspaceId: campaign.workspaceId, leadId, prospectId: prospect.id, channel: "email", type: "auto_reply", provider: "resend", providerEventId: `${opts.eventId}:email.received`, externalMessageId: opts.emailId, occurredAt: opts.occurredAt });
  } else if (rejection) {
    await blockLeadCompletely({ workspaceId: campaign.workspaceId, leadId, email: fromEmail, reason: "Indicó por email que no le interesa o solicitó la baja", source: "resend_inbound" });
  } else {
    await markLeadHumanReply({ workspaceId: campaign.workspaceId, leadId, channel: "email", body: freshText });
    // La respuesta no queda escondida en el motor de cadencias: entra también
    // en la bandeja/tareas de Sonia para que el equipo pueda atenderla.
    await triggerNvIaFromInbound({
      workspaceId: campaign.workspaceId,
      externalId: `resend:${opts.emailId}`,
      trigger: "EMAIL_INBOUND",
      taskTitle: `📧 Respuesta de ${String(received.from ?? fromEmail).slice(0, 80)}: ${subject.slice(0, 100) || "(sin asunto)"}`,
      body: freshText.slice(0, 16000),
      metadata: { from: String(received.from ?? fromEmail), to: recipients.join(", "), subject, messageId: opts.emailId, leadId, prospectId: prospect.id },
      clientId: null
    });
  }
  return NextResponse.json({ ok: true, matched: true });
}

function eventRecipient(data: any): string | null {
  const raw = Array.isArray(data?.to) ? data.to[0] : data?.to;
  return normalizeEmail(String(raw ?? "").match(/[\w.+-]+@[\w.-]+/)?.[0]);
}

function eventTag(data: any, name: string): string | null {
  const tags = data?.tags;
  if (Array.isArray(tags)) {
    const match = tags.find((tag) => String(tag?.name ?? "").toLowerCase() === name.toLowerCase());
    return match ? String(match.value ?? "") : null;
  }
  if (tags && typeof tags === "object") {
    const entry = Object.entries(tags).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry ? String(entry[1] ?? "") : null;
  }
  return null;
}

function messageIdTokens(value: string): string[] {
  const bracketed = value.match(/<[^<>\s]+>/g);
  const values = bracketed?.length ? bracketed : value.split(/\s+/);
  return values.map((item) => item.trim().replace(/^<|>$/g, "").toLowerCase()).filter(Boolean);
}

function normalizeRfcMessageId(value: string): string | null {
  return messageIdTokens(value)[0] ?? null;
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<\/?[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function headerValue(headers: unknown, name: string): string {
  if (!headers || typeof headers !== "object") return "";
  const entry = Object.entries(headers as Record<string, unknown>).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return String(entry?.[1] ?? "");
}

function replySubject(value: string): string {
  return value.replace(/^\s*((re|rv|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase();
}

function unquotedReply(value: string): string {
  const marker = /\n(?:on .{0,240}wrote:|el .{0,240}escribi[oó]:|-{2,}\s*(?:original message|mensaje original)\s*-{2,}|from:\s|de:\s)/i;
  const match = marker.exec(value);
  const head = match ? value.slice(0, match.index) : value;
  return head.split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join("\n").trim();
}
