import "server-only";
import { prisma } from "@/lib/prisma";
import { findOrCreateContactByPhone } from "@/lib/contacts";
import { normalizePhone } from "@/lib/phone";
import type { WorkspaceSettings } from "@/lib/settings";
import { ensurePrimaryLine, listLines } from "@/lib/inbox/lines";
import crypto from "crypto";
import { describeDecision, enqueueOutbound, LEAD_WELCOME_KEY_PREFIX, OutboundError } from "@/lib/inbox/outbound";
import { isPlaceholderName } from "@/lib/inbox/text";
import { COLD_AFTER_DAYS } from "@/lib/inbox/safety";
import {
  appendLeadInfo,
  matchLine,
  NEW_LEAD_STATUS,
  renderLeadTemplate,
  type LeadPayload,
} from "@/lib/leads/config";

export type LeadIntakeResult = {
  ok: true;
  duplicate?: boolean;
  contactId: string;
  conversationId: string | null;
  line: string | null;
  welcome: { status: "queued" | "blocked" | "skipped"; reason?: string; scheduledAt?: string };
  warnings: string[];
};

// Alta de un lead que llega de Make (formulario de Meta). Nunca pierde el lead:
// si el teléfono no es válido o el número del CRM no existe, se guarda igual y
// se devuelve un aviso.
export async function ingestLead(
  ws: { id: string; settings: WorkspaceSettings },
  lead: LeadPayload
): Promise<LeadIntakeResult> {
  const warnings: string[] = [];
  const countryCode = ws.settings.whatsapp.countryCode || "34";
  const phone = normalizePhone(lead.phone, countryCode);
  const now = new Date();
  const lines = await listLines(ws.id);
  const line = matchLine(lines, lead.line);
  if (lead.line && !line) warnings.push(`No hay ningún número del CRM que coincida con «${lead.line}»: el lead entra sin número asignado.`);

  // Sin lead_id de Meta, el mismo lead (teléfono + formulario + campaña + día)
  // se reconoce igual si Make lo reintenta.
  const entryId =
    lead.leadId ??
    `h:${crypto
      .createHash("sha1")
      .update([phone ?? lead.phone, lead.form ?? "", lead.campaign ?? "", lead.treatment ?? "", now.toISOString().slice(0, 10)].join("|"))
      .digest("hex")
      .slice(0, 16)}`;
  const entry = {
    id: entryId,
    at: now.toISOString(),
    campaign: lead.campaign,
    treatment: lead.treatment,
    form: lead.form,
    adName: lead.adName,
    lineLabel: line?.label ?? null,
    fields: [
      ...(lead.email ? [{ label: "Email", value: lead.email }] : []),
      ...(phone ? [] : [{ label: "Teléfono recibido", value: lead.phone }]),
      ...lead.fields,
    ],
  };

  // Sin teléfono válido: ficha sin WhatsApp para que alguien lo revise.
  if (!phone || phone.includes("@")) {
    const contact = await prisma.contact.create({
      data: {
        workspaceId: ws.id,
        name: lead.name || lead.phone,
        email: lead.email,
        stage: "nuevos",
        source: "meta",
        leadStatus: NEW_LEAD_STATUS,
        leadStatusAt: now,
        leadInfo: appendLeadInfo(null, entry) as any,
      },
    });
    warnings.push(`Teléfono no válido («${lead.phone}»): se ha creado la ficha sin WhatsApp.`);
    return { ok: true, contactId: contact.id, conversationId: null, line: line?.label ?? null, welcome: { status: "skipped", reason: "Teléfono no válido" }, warnings };
  }

  let contact = await findOrCreateContactByPhone({ workspaceId: ws.id, phone, name: lead.name || undefined, source: "meta" });
  const info = appendLeadInfo(contact.leadInfo, entry);
  // Make reintentó el mismo lead: la ficha y la bandeja no se tocan, pero si el
  // primer intento falló antes de dejar el mensaje en cola, se completa ahora
  // (la clave del mensaje evita enviarlo dos veces).
  const duplicate = !info;
  if (info) {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: {
        leadInfo: info as any,
        leadStatus: NEW_LEAD_STATUS,
        leadStatusAt: now,
        ...(lead.email && !contact.email ? { email: lead.email } : {}),
        ...(lead.name && isPlaceholderName(contact.name, contact.phone) ? { name: lead.name } : {}),
      },
    });
  }

  const existing = await prisma.conversation.findUnique({ where: { workspaceId_phone: { workspaceId: ws.id, phone } } });
  const recentChat = Boolean(
    existing?.lastInboundAt && now.getTime() - existing.lastInboundAt.getTime() < COLD_AFTER_DAYS * 86_400_000
  );
  const primary = line ? null : await ensurePrimaryLine(ws.id);
  // Si el cliente ya está hablando por otro número, se sigue por ese número.
  // Si Make pide un número que no existe, el lead entra sin número (nunca por otro).
  const lineId = recentChat
    ? existing!.lineId
    : line?.id ?? existing?.lineId ?? (lead.line ? null : primary?.id ?? null);
  const preview = `🆕 Lead${lead.treatment || lead.campaign ? ` · ${lead.treatment || lead.campaign}` : ""}`.slice(0, 160);
  const conversation = duplicate && existing
    ? existing
    : existing
    ? await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          lineId,
          contactId: existing.contactId ?? contact.id,
          unread: { increment: 1 },
          archived: false,
          lastMessageAt: now,
          ...(recentChat ? {} : { lastPreview: preview, lastDirection: null }),
        },
      })
    : await prisma.conversation.create({
        data: {
          workspaceId: ws.id,
          phone,
          chatId: phone,
          lineId,
          contactId: contact.id,
          unread: 1,
          lastMessageAt: now,
          lastPreview: preview,
        },
      });

  // Primer mensaje: el que mande Make o la plantilla del número asignado.
  const assignedLine = lineId ? lines.find((l) => l.id === lineId) ?? null : null;
  const template = (lead.message ?? assignedLine?.leadWelcome ?? "").trim();
  let welcome: LeadIntakeResult["welcome"] = { status: "skipped" };
  if (!lead.sendWelcome) welcome = { status: "skipped", reason: "Make pidió no enviar mensaje" };
  else if (recentChat) welcome = { status: "skipped", reason: "El cliente ya tiene una conversación reciente: sin mensaje automático" };
  else if (lead.line && !line) welcome = { status: "skipped", reason: `No existe el número «${lead.line}» en el CRM: no se envía nada para no escribir desde otro número` };
  else if (!assignedLine) welcome = { status: "skipped", reason: "Sin número asignado" };
  else if (!template) welcome = { status: "skipped", reason: `El número ${assignedLine.label} no tiene primer mensaje para leads` };
  else {
    const body = renderLeadTemplate(template, { name: contact.name, treatment: lead.treatment, campaign: lead.campaign });
    // Clave «lead:…» ligada al negocio, al teléfono y al lead: el envío se
    // reconoce como mensaje automático (no aparta a la IA) y nunca se duplica.
    const key = `${LEAD_WELCOME_KEY_PREFIX}${crypto.createHash("sha1").update(`${ws.id}|${phone}|${entryId}`).digest("hex").slice(0, 32)}`;
    try {
      const { outbound, decision } = await enqueueOutbound({
        workspaceId: ws.id,
        conversationId: conversation.id,
        body,
        origin: "manual",
        idempotencyKey: key,
      });
      if (decision.kind === "block") {
        welcome = { status: "blocked", reason: describeDecision(decision).message };
        warnings.push(`Primer mensaje no enviado: ${describeDecision(decision).message}`);
      } else if (duplicate && outbound.status !== "queued") {
        welcome = { status: "skipped", reason: "Lead ya recibido: el primer mensaje ya se envió" };
      } else {
        welcome = { status: "queued", scheduledAt: outbound.scheduledAt.toISOString(), ...(decision.kind === "defer" ? { reason: decision.reason } : {}) };
      }
    } catch (error) {
      // La plantilla cambió entre el primer intento y el reintento: ya se envió el primero.
      if (error instanceof OutboundError && error.code === "IDEMPOTENCY_MISMATCH") {
        welcome = { status: "skipped", reason: "Lead ya recibido: el primer mensaje ya se envió" };
      } else throw error;
    }
  }
  return {
    ok: true,
    ...(duplicate ? { duplicate: true } : {}),
    contactId: contact.id,
    conversationId: conversation.id,
    line: assignedLine?.label ?? null,
    welcome,
    warnings,
  };
}
