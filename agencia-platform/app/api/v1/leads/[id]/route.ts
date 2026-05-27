/**
 * GET /api/v1/leads/[id]
 *
 * Detalle completo de un lead + histórico de mensajes (saliente + entrante)
 * ordenado cronológicamente. Usado por el modal "Tarjeta detalle del lead".
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { api, params }) => {
  const id = (params as any)?.id as string;
  if (!id) throw new ApiError(400, "missing_id", "Falta id");

  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId: api.workspaceId },
    include: {
      search: { select: { id: true, keyword: true, location: true } },
      competitors: { orderBy: { position: "asc" }, take: 3 },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          channel: true,
          status: true,
          renderedMessage: true,
          phoneNormalized: true,
          scheduledAt: true,
          sentAt: true,
          sendAttempts: true,
          lastError: true,
          createdAt: true
        }
      },
      inboxMessages: {
        orderBy: { receivedAt: "asc" },
        select: {
          id: true,
          fromPhone: true,
          body: true,
          classification: true,
          classificationConfidence: true,
          receivedAt: true
        }
      }
    }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  // Línea temporal unificada: outbound + inbound mezclados por timestamp.
  const timeline = [
    ...lead.messages.map((m) => ({
      kind: "out" as const,
      ts: m.sentAt ?? m.scheduledAt ?? m.createdAt,
      message: m.renderedMessage,
      status: m.status,
      sendAttempts: m.sendAttempts,
      lastError: m.lastError
    })),
    ...lead.inboxMessages.map((m) => ({
      kind: "in" as const,
      ts: m.receivedAt,
      message: m.body,
      classification: m.classification,
      classificationConfidence: m.classificationConfidence
    }))
  ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  return NextResponse.json({ lead, timeline });
});
