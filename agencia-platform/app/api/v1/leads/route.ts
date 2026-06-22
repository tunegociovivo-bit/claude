import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { SENT_STATUSES } from "@/lib/leads/send-queue";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("contactStatus") ?? undefined;
  const urgency = url.searchParams.get("urgency") ?? undefined;
  const province = url.searchParams.get("province") ?? undefined;
  const searchId = url.searchParams.get("searchId") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const ticketTier = url.searchParams.get("ticketTier") ?? undefined;
  // sort=ticket → prioriza captación de ticket alto; por defecto, "dolor ahora".
  const sort = url.searchParams.get("sort") ?? undefined;
  const orderBy: any =
    sort === "ticket"
      ? [{ ticketScore: "desc" }, { score: "desc" }, { createdAt: "desc" }]
      : [{ score: "desc" }, { createdAt: "desc" }];
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
  // Paginación: offset para ir trayendo páginas sucesivas ("Cargar más").
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  const where: any = { workspaceId: api.workspaceId };
  if (status) where.contactStatus = status;
  if (urgency) where.urgency = urgency;
  if (province) where.province = province;
  if (searchId) where.searchId = searchId;
  if (ticketTier) where.ticketTier = ticketTier;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { province: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { website: { contains: search, mode: "insensitive" } }
    ];
  }

  // Modo "idsOnly": devuelve TODOS los leads que cumplen el filtro (sin
  // paginar) pero solo con los campos mínimos. Lo usa el botón "Seleccionar
  // todos" de la tabla para marcar de un clic los leads de todas las páginas.
  if (url.searchParams.get("idsOnly") === "1") {
    const rows = await prisma.lead.findMany({
      where,
      orderBy,
      select: { id: true, phone: true, contactStatus: true, rating: true, reviewsCount: true }
    });
    return NextResponse.json({ items: rows, total: rows.length });
  }

  // Total real de leads que cumplen el filtro (para el contador "X de Y" y
  // para saber si quedan más páginas por cargar en la tabla).
  const total = await prisma.lead.count({ where });
  const items = await prisma.lead.findMany({
    where,
    orderBy,
    skip: offset,
    take: limit,
    select: {
      id: true,
      name: true,
      province: true,
      category: true,
      phone: true,
      website: true,
      rating: true,
      reviewsCount: true,
      position: true,
      score: true,
      urgency: true,
      ticketScore: true,
      ticketTier: true,
      contactStatus: true,
      aiOpener: true,
      hasWhatsapp: true,
      latitude: true,
      longitude: true,
      search: { select: { keyword: true, location: true } },
      _count: {
        select: {
          // Solo mensajes que SALIERON de verdad por WhatsApp (incluye los
          // confirmados como entregados/leídos por el webhook de WAHA).
          messages: { where: { status: { in: SENT_STATUSES } } }
        }
      },
      // Próximo mensaje encolado pendiente de salir (para mostrar la hora
      // a la que el lead recibirá la próxima comunicación de Sonia).
      messages: {
        where: { status: { in: ["queued", "sending"] } },
        orderBy: { scheduledAt: "asc" },
        take: 1,
        select: { scheduledAt: true, status: true }
      }
    }
  });
  // Aplana _count.messages → messagesSent y derivado nextScheduledAt.
  const flat = items.map((l) => {
    const { _count, messages, search, ...rest } = l as any;
    const next = Array.isArray(messages) && messages.length > 0 ? messages[0] : null;
    return {
      ...rest,
      searchQuery: search?.keyword ?? null,
      searchLocation: search?.location ?? null,
      messagesSent: _count?.messages ?? 0,
      nextScheduledAt: next?.scheduledAt ?? null
    };
  });
  return NextResponse.json({ items: flat, total });
});
