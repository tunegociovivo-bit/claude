import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { getWorkspaceSettings } from "@/lib/settings";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import {
  backfillConversations,
  fillPlaceholderContactNames,
  isPlaceholderName,
  latestPushNames,
  resolveMissingNamesInBackground,
} from "@/lib/inbox/conversations";
import { listLines } from "@/lib/inbox/lines";
import { describeDecision, enqueueOutbound, processIfDue } from "@/lib/inbox/outbound";
import { findOrCreateContactByPhone } from "@/lib/contacts";

export const dynamic = "force-dynamic";

// GET → bandeja unificada: conversaciones de todos los números del negocio.
export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await requireInboxUser();
    await backfillConversations(workspaceId);
    const params = new URL(req.url).searchParams;
    if (params.get("summary") === "1") {
      const unread = await prisma.conversation.count({ where: { workspaceId, archived: false, unread: { gt: 0 } } });
      return Response.json({ totals: { unreadChats: unread } });
    }
    const lineId = params.get("line");
    const filter = params.get("filter") ?? "all";
    const q = (params.get("q") ?? "").trim().slice(0, 80);

    const where: Prisma.ConversationWhereInput = { workspaceId };
    if (lineId && lineId !== "all") where.lineId = lineId;
    if (filter === "archived") where.archived = true;
    else where.archived = false;
    if (filter === "unread") where.unread = { gt: 0 };
    if (filter === "pending") where.lastDirection = "in";
    if (filter === "drafts") where.aiDraft = { not: null };
    if (filter === "optout") where.optedOut = true;
    if (q) {
      const contacts = await prisma.contact.findMany({
        where: { workspaceId, name: { contains: q, mode: "insensitive" } },
        select: { id: true },
        take: 200,
      });
      const digits = q.replace(/\D/g, "");
      where.OR = [
        { lastPreview: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ...(contacts.length ? [{ contactId: { in: contacts.map((c) => c.id) } }] : []),
      ];
    }

    const [rows, lines, unreadByLine] = await Promise.all([
      prisma.conversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 300 }),
      listLines(workspaceId),
      prisma.conversation.groupBy({
        by: ["lineId"],
        where: { workspaceId, archived: false, unread: { gt: 0 } },
        _sum: { unread: true },
        _count: { _all: true },
      }),
    ]);
    const contactIds = rows.map((r) => r.contactId).filter((id): id is string => Boolean(id));
    const contacts = contactIds.length
      ? await prisma.contact.findMany({
          where: { workspaceId, id: { in: contactIds } },
          select: { id: true, name: true, stage: true, phone: true },
        })
      : [];
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    // Nombre real de WhatsApp para los chats sin nombre (y se guarda en la ficha).
    const needName = rows.filter((r) => {
      const c = r.contactId ? contactById.get(r.contactId) : null;
      return !c || isPlaceholderName(c.name, c.phone);
    });
    const pushNames = await latestPushNames(workspaceId, needName.map((r) => r.phone));
    const pushByContact = new Map<string, string>();
    for (const r of needName) {
      const name = pushNames.get(r.phone);
      if (name && r.contactId) pushByContact.set(r.contactId, name);
    }
    if (pushByContact.size) {
      await fillPlaceholderContactNames(workspaceId, contacts, pushByContact);
      for (const [id, name] of pushByContact) {
        const c = contactById.get(id);
        if (c && isPlaceholderName(c.name, c.phone)) contactById.set(id, { ...c, name });
      }
    }
    // Los que siguen sin nombre se consultan a WAHA en segundo plano.
    resolveMissingNamesInBackground(
      workspaceId,
      needName
        .filter((r) => !pushNames.has(r.phone))
        .map((r) => ({
          phone: r.phone,
          chatId: r.chatId,
          lineId: r.lineId,
          contact: r.contactId ? contactById.get(r.contactId) ?? null : null,
        }))
    );
    const now = Date.now();

    return Response.json({
      conversations: rows.map((r) => ({
        id: r.id,
        phone: r.phone,
        lineId: r.lineId,
        unread: r.unread,
        lastMessageAt: r.lastMessageAt,
        lastPreview: r.lastPreview,
        lastDirection: r.lastDirection,
        aiStatus: r.aiStatus,
        hasDraft: Boolean(r.aiDraft),
        optedOut: r.optedOut,
        archived: r.archived,
        humanActive: Boolean(r.humanUntil && r.humanUntil.getTime() > now),
        contact: r.contactId ? contactById.get(r.contactId) ?? null : null,
        pushName: pushNames.get(r.phone) ?? null,
      })),
      lines: lines.map((l) => {
        const unread = unreadByLine.find((u) => u.lineId === l.id);
        return {
          id: l.id,
          label: l.label,
          phone: l.phone,
          isPrimary: l.isPrimary,
          mode: l.mode,
          active: l.active,
          aiMode: l.aiMode,
          lastStatus: l.lastStatus,
          paused: Boolean(l.pausedUntil && l.pausedUntil.getTime() > now),
          unreadChats: unread?._count._all ?? 0,
        };
      }),
      totals: {
        unreadChats: unreadByLine.reduce((sum, u) => sum + u._count._all, 0),
      },
    });
  } catch (error) {
    return inboxError(error);
  }
}

// POST → iniciar una conversación nueva (solo si el número lo permite: por
// defecto los números están en modo «solo responder»).
const startSchema = z.object({
  phone: z.string().min(6).max(30),
  lineId: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
  name: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().min(8).max(80).optional(),
});

export async function POST(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxUser();
    const parsed = startSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    const settings = await getWorkspaceSettings(user.workspaceId);
    const phone = normalizePhone(parsed.data.phone, settings.whatsapp.countryCode);
    if (!phone || phone.includes("@")) return Response.json({ error: "Teléfono no válido" }, { status: 400 });
    const line = await prisma.whatsappLine.findFirst({ where: { id: parsed.data.lineId, workspaceId: user.workspaceId } });
    if (!line) return Response.json({ error: "Número no encontrado" }, { status: 404 });
    const contact = await findOrCreateContactByPhone({
      workspaceId: user.workspaceId,
      phone,
      name: parsed.data.name,
      source: "whatsapp",
    });
    const existing = await prisma.conversation.findUnique({
      where: { workspaceId_phone: { workspaceId: user.workspaceId, phone } },
      select: { id: true, lastInboundAt: true },
    });
    // Si el cliente ya escribió a un número, se le contesta por ese mismo
    // número; si nunca escribió, sale por el número elegido.
    const conversation = await prisma.conversation.upsert({
      where: { workspaceId_phone: { workspaceId: user.workspaceId, phone } },
      create: { workspaceId: user.workspaceId, phone, chatId: phone, lineId: line.id, contactId: contact.id },
      update: existing?.lastInboundAt ? {} : { lineId: line.id },
    });
    const { outbound, decision } = await enqueueOutbound({
      workspaceId: user.workspaceId,
      conversationId: conversation.id,
      body: parsed.data.text,
      origin: "manual",
      userId: user.userId,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    });
    if (decision.kind === "block" && !existing) {
      // No dejar en la bandeja un chat vacío que nunca llegó a empezar.
      await prisma.outboundMessage.deleteMany({ where: { conversationId: conversation.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      return Response.json({ conversationId: null, result: describeDecision(decision) }, { status: 422 });
    }
    const final = await processIfDue(outbound);
    return Response.json(
      { conversationId: conversation.id, outbound: final, result: describeDecision(decision) },
      { status: decision.kind === "block" ? 422 : 201 }
    );
  } catch (error) {
    return inboxError(error);
  }
}
