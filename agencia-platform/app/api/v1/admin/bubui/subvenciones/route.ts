/**
 * GET /api/v1/admin/bubui/subvenciones
 * Lista las propuestas de subvenciones para comercios de Bubui. Las
 * pendientes de revisión primero. El admin las aprueba/rechaza desde el
 * panel (/admin/subvenciones).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async () => {
  const rows = await prisma.bubuiSubvencionProposal.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 150,
    include: {
      business: {
        select: { id: true, name: true, category: true, city: true, ownerEmail: true, ownerPhone: true, phone: true, slug: true }
      }
    }
  });

  // Pendientes arriba.
  const order: Record<string, number> = { pending: 0, sent: 1, accepted: 2, rejected: 3 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  const items = rows.map((p) => ({
    id: p.id,
    status: p.status,
    createdAt: p.createdAt,
    sentAt: p.sentAt,
    respondedAt: p.respondedAt,
    sentWhatsapp: p.sentWhatsapp,
    sentEmail: p.sentEmail,
    matches: p.matches,
    business: {
      id: p.business.id,
      name: p.business.name,
      category: p.business.category,
      city: p.business.city,
      email: p.business.ownerEmail,
      phone: p.business.ownerPhone || p.business.phone || null,
      slug: p.business.slug
    }
  }));

  const counts = {
    pending: items.filter((i) => i.status === "pending").length,
    sent: items.filter((i) => i.status === "sent").length,
    accepted: items.filter((i) => i.status === "accepted").length
  };

  return NextResponse.json({ items, counts });
});
