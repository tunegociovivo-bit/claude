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
import {
  buildConversations,
  resolveAccountWhere,
  accountOptionsFromGroups,
  isSearchable,
  normalizeSearch,
  collectSearchMatches,
  searchWhereInbox,
  searchWhereOutbound,
  MIN_SEARCH_CHARS,
  type BlockedFilter,
  type MatchInfo
} from "@/lib/leads/inbox-conversations";

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

  // Búsqueda por CONTENIDO de mensaje (en LeadInboxMessage + LeadMessage). Se
  // resuelve en servidor: primero se localizan los teléfonos/leads cuyo texto
  // (entrante o saliente, también antiguo) casa; luego se agrupan SUS mensajes.
  const rawQ = url.searchParams.get("q");
  const searching = isSearchable(rawQ);
  const term = normalizeSearch(rawQ);

  let snippetByPhone: Map<string, MatchInfo> | undefined;
  let snippetByLeadId: Map<string, MatchInfo> | undefined;
  let searchRestriction: any = null;

  if (searching) {
    const SEARCH_TAKE = 2000; // tope defensivo por consulta de búsqueda
    // Contenido de mensajes (entrantes + salientes) → con fragmento.
    // Identidad (nombre de lead / teléfono / alias de la conversación) → sin
    // fragmento, para no perder la búsqueda por "quién" que ya existía.
    const [inboxHits, outboundHits, leadHits, metaHits] = await Promise.all([
      prisma.leadInboxMessage.findMany({
        where: searchWhereInbox(api.workspaceId, term),
        select: { phoneNormalized: true, fromPhone: true, leadId: true, body: true },
        take: SEARCH_TAKE
      }),
      prisma.leadMessage.findMany({
        where: searchWhereOutbound(api.workspaceId, term),
        select: { phoneNormalized: true, leadId: true, renderedMessage: true },
        take: SEARCH_TAKE
      }),
      prisma.lead.findMany({
        where: { workspaceId: api.workspaceId, OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }] },
        select: { id: true },
        take: SEARCH_TAKE
      }),
      prisma.leadConversationMeta.findMany({
        where: { workspaceId: api.workspaceId, displayName: { contains: term, mode: "insensitive" } },
        select: { phone: true },
        take: SEARCH_TAKE
      })
    ]);
    const matches = collectSearchMatches({ inbox: inboxHits, outbound: outboundHits }, term);
    // Añade los aciertos por identidad (sin fragmento).
    for (const l of leadHits) matches.matchedLeadIds.add(l.id);
    for (const mt of metaHits) if (mt.phone) matches.matchedPhones.add(mt.phone);
    snippetByPhone = matches.snippetByPhone;
    snippetByLeadId = matches.snippetByLeadId;

    const phones = [...matches.matchedPhones];
    const leadIds = [...matches.matchedLeadIds];
    if (phones.length === 0 && leadIds.length === 0) {
      // Nada casa → devolvemos vacío (con las opciones de cuenta reales).
      const accountsEmpty = accountOptionsFromGroups([
        ...(await prisma.leadInboxMessage.groupBy({ by: ["instanceName"], where: { workspaceId: api.workspaceId } })),
        ...(await prisma.leadMessage.groupBy({ by: ["instanceName"], where: { workspaceId: api.workspaceId } }))
      ]);
      return NextResponse.json({ items: [], accounts: accountsEmpty, total: 0, totalUnread: 0, search: { applied: true, min: MIN_SEARCH_CHARS, term } });
    }
    // Restringe el agrupado a las conversaciones que casaron (por teléfono o lead).
    const or: any[] = [];
    if (phones.length) or.push({ phoneNormalized: { in: phones } }, { fromPhone: { in: phones } });
    if (leadIds.length) or.push({ leadId: { in: leadIds } });
    searchRestriction = { OR: or };
  }

  const msgWhere: any = { workspaceId: api.workspaceId, ...resolveAccountWhere(account) };
  if (hasDate) msgWhere.receivedAt = { gte: from, lt: to };
  if (searchRestriction) msgWhere.AND = [searchRestriction];

  // Un día concreto (o una búsqueda) están acotados → ampliamos el tope para no
  // perder convos; sin fecha ni búsqueda, el corte habitual de recientes.
  const take = hasDate || searching ? 5000 : 1000;

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

  const items = buildConversations(msgs as any, metas as any, {
    optoutPhones,
    optoutLeadIds,
    blocked,
    snippetByPhone,
    snippetByLeadId
  });

  const accounts = accountOptionsFromGroups([...inboxAccounts, ...outboundAccounts]);

  return NextResponse.json({
    items,
    accounts,
    total: items.length,
    totalUnread: items.reduce((s, c) => s + c.unread, 0),
    search: searching ? { applied: true, min: MIN_SEARCH_CHARS, term } : { applied: false, min: MIN_SEARCH_CHARS }
  });
});
