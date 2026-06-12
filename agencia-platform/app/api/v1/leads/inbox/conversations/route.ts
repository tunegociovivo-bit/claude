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

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  // Modo ligero para el badge de la pestaña: solo el nº de no-leídos.
  if (new URL(req.url).searchParams.get("countOnly") === "1") {
    const totalUnread = await prisma.leadInboxMessage.count({
      where: { workspaceId: api.workspaceId, direction: "in", read: false }
    });
    return NextResponse.json({ totalUnread });
  }

  // Últimos 1000 mensajes del inbox → agrupar por teléfono en JS (los
  // workspaces de leads tienen volúmenes moderados; si crece, se pagina).
  const [msgs, metas] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where: { workspaceId: api.workspaceId },
      orderBy: { receivedAt: "desc" },
      take: 1000,
      include: { lead: { select: { id: true, name: true, phone: true } } }
    }),
    prisma.leadConversationMeta.findMany({ where: { workspaceId: api.workspaceId } })
  ]);
  const metaByPhone = new Map(metas.map((m) => [m.phone, m]));

  type Conv = {
    phone: string;
    leadId: string | null;
    leadName: string | null;
    leadPhone: string | null;
    displayName: string | null;
    note: string | null;
    priority: string;
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
      const meta = metaByPhone.get(phone);
      c = {
        phone,
        leadId: m.lead?.id ?? null,
        leadName: m.lead?.name ?? null,
        leadPhone: m.lead?.phone ?? null,
        displayName: meta?.displayName ?? null,
        note: meta?.note ?? null,
        priority: meta?.priority ?? "none",
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
      c.leadPhone = m.lead.phone ?? null;
    }
    if (m.direction === "in") {
      if (!m.read) c.unread++;
      // Canal de respuesta = el del entrante más reciente.
      if (c.instanceName === null && m.instanceName) c.instanceName = m.instanceName;
      if (c.classification === null && m.classification) c.classification = m.classification;
    }
  }

  // Orden: prioridad (alta > media > baja > none) y, dentro, actividad
  // reciente — así "en quién centrarse" queda siempre arriba.
  const RANK: Record<string, number> = { alta: 0, media: 1, baja: 2, none: 3 };
  const items = Array.from(byPhone.values()).sort(
    (a, b) => (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) || b.lastAt.getTime() - a.lastAt.getTime()
  );
  return NextResponse.json({ items, totalUnread: items.reduce((s, c) => s + c.unread, 0) });
});
