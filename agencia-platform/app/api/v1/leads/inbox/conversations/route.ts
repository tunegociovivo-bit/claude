/**
 * GET /api/v1/leads/inbox/conversations
 *
 * Lista de CONVERSACIONES del inbox multi-WhatsApp (estilo WhatsApp Web):
 * una fila por teléfono, con el último mensaje, no-leídos, lead vinculado,
 * clasificación IA del último entrante y por qué número (sesión/instancia)
 * llegó. Orden: actividad más reciente primero.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  // Últimos 1000 mensajes del inbox → agrupar por teléfono en JS (los
  // workspaces de leads tienen volúmenes moderados; si crece, se pagina).
  const msgs = await prisma.leadInboxMessage.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { receivedAt: "desc" },
    take: 1000,
    include: { lead: { select: { id: true, name: true } } }
  });

  type Conv = {
    phone: string;
    leadId: string | null;
    leadName: string | null;
    lastBody: string;
    lastAt: Date;
    lastDirection: string;
    unread: number;
    instanceName: string | null;
    classification: string | null;
  };
  const byPhone = new Map<string, Conv>();
  for (const m of msgs) {
    const phone = m.phoneNormalized ?? m.fromPhone;
    let c = byPhone.get(phone);
    if (!c) {
      c = {
        phone,
        leadId: m.lead?.id ?? null,
        leadName: m.lead?.name ?? null,
        lastBody: m.body,
        lastAt: m.receivedAt,
        lastDirection: m.direction,
        unread: 0,
        instanceName: null,
        classification: null
      };
      byPhone.set(phone, c);
    }
    // msgs viene desc → el primero por teléfono ya es el último mensaje.
    if (!c.leadId && m.lead) {
      c.leadId = m.lead.id;
      c.leadName = m.lead.name;
    }
    if (m.direction === "in") {
      if (!m.read) c.unread++;
      // Canal de respuesta = el del entrante más reciente.
      if (c.instanceName === null && m.instanceName) c.instanceName = m.instanceName;
      if (c.classification === null && m.classification) c.classification = m.classification;
    }
  }

  const items = Array.from(byPhone.values()).sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  return NextResponse.json({ items, totalUnread: items.reduce((s, c) => s + c.unread, 0) });
});
