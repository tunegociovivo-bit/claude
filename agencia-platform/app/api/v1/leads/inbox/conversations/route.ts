/**
 * GET /api/v1/leads/inbox/conversations
 *
 * Lista de CONVERSACIONES del inbox multi-WhatsApp (estilo WhatsApp Web):
 * una fila por teléfono, con el último mensaje, no-leídos, lead vinculado,
 * clasificación IA del último entrante y por qué número (sesión/instancia)
 * llegó. Orden: actividad más reciente primero.
 *
 * Filtros (server-side, combinables — no se filtra en cliente sobre una lista
 * paginada):
 *   - account=<instanceName>  cuenta/número de WhatsApp que gestionó la convo.
 *   - dateFrom, dateTo (ISO)  rango de un DÍA LOCAL exacto (lo calcula el
 *                             cliente con su huso; aquí solo comparamos instantes).
 *   - blocked=all|blocked|unblocked  usa el opt-out real (LeadOptout) que crea
 *                             la acción "🚫 Bloquear para siempre".
 * Devuelve además `accounts` (opciones reales) y `total` (conteo del segmento).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { buildConversations, resolveAccountWhere, accountOptionsFromGroups, type BlockedFilter } from "@/lib/leads/inbox-conversations";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);

  // Modo ligero para el badge de la pestaña: nº de no-leídos en conversaciones
  // NO archivadas (las archivadas no deben hacer parpadear la pestaña).
  if (url.searchParams.get("countOnly") === "1") {
    const [unreadMsgs, archived] = await Promise.all([
      prisma.leadInboxMessage.findMany({
        where: { workspaceId: api.workspaceId, direction: "in", read: false },
        select: { phoneNormalized: true, fromPhone: true }
      }),
      prisma.leadConversationMeta.findMany({
        where: { workspaceId: api.workspaceId, archived: true },
        select: { phone: true }
      })
    ]);
    const archivedSet = new Set(archived.map((a) => a.phone));
    const totalUnread = unreadMsgs.filter((m) => !archivedSet.has(m.phoneNormalized ?? m.fromPhone)).length;
    return NextResponse.json({ totalUnread });
  }

  // ── Parámetros de filtro ──────────────────────────────────────────────────
  const account = (url.searchParams.get("account") ?? "").trim() || null;
  const blocked = ((): BlockedFilter => {
    const v = url.searchParams.get("blocked");
    return v === "blocked" || v === "unblocked" ? v : "all";
  })();
  const fromParam = url.searchParams.get("dateFrom");
  const toParam = url.searchParams.get("dateTo");
  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam) : null;
  const hasDate = !!(from && to && !isNaN(from.getTime()) && !isNaN(to.getTime()));

  const msgWhere: any = { workspaceId: api.workspaceId, ...resolveAccountWhere(account) };
  if (hasDate) msgWhere.receivedAt = { gte: from, lt: to };

  // Un día concreto está acotado → ampliamos el tope para no perder convos de
  // ese día; sin fecha, el corte habitual de recientes.
  const take = hasDate ? 5000 : 1000;

  const [msgs, metas, optouts, inboxAccounts, outboundAccounts] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where: msgWhere,
      orderBy: { receivedAt: "desc" },
      take,
      include: { lead: { select: { id: true, name: true, phone: true } } }
    }),
    prisma.leadConversationMeta.findMany({ where: { workspaceId: api.workspaceId } }),
    // Estado persistido real de "Bloquear para siempre".
    prisma.leadOptout.findMany({ where: { workspaceId: api.workspaceId }, select: { phone: true, leadId: true } }),
    // Opciones reales de cuenta de WhatsApp (entrantes y salientes).
    prisma.leadInboxMessage.groupBy({ by: ["instanceName"], where: { workspaceId: api.workspaceId } }),
    prisma.leadMessage.groupBy({ by: ["instanceName"], where: { workspaceId: api.workspaceId } })
  ]);

  const optoutPhones = new Set(optouts.map((o) => o.phone));
  const optoutLeadIds = new Set(optouts.filter((o) => o.leadId).map((o) => o.leadId as string));

  const items = buildConversations(msgs as any, metas as any, { optoutPhones, optoutLeadIds, blocked });

  const accounts = accountOptionsFromGroups([...inboxAccounts, ...outboundAccounts]);

  return NextResponse.json({
    items,
    accounts,
    total: items.length,
    totalUnread: items.reduce((s, c) => s + c.unread, 0)
  });
});
