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

  // Métricas agregadas sobre TODAS las propuestas (no solo las 150 listadas).
  const all = await prisma.bubuiSubvencionProposal.findMany({
    take: 3000,
    select: { status: true, matches: true, business: { select: { category: true, city: true } } }
  });

  const counts = {
    pending: all.filter((i) => i.status === "pending").length,
    sent: all.filter((i) => i.status === "sent").length,
    accepted: all.filter((i) => i.status === "accepted").length,
    rejected: all.filter((i) => i.status === "rejected").length
  };

  // % de validación: de las enviadas, cuántas acepta el comercio.
  const enviadasTotal = counts.sent + counts.accepted;
  const validationRate = enviadasTotal > 0 ? Math.round((counts.accepted / enviadasTotal) * 100) : 0;

  // € "en juego": suma del importe de las ayudas de las propuestas ACEPTADAS
  // (comercios que quieren que se las gestionemos). Proxy de oportunidad.
  let eurosEnJuego = 0;
  const bySector: Record<string, number> = {};
  const byZona: Record<string, number> = {};
  for (const p of all) {
    const ms = (p.matches as unknown as { importeTotal?: number | null }[]) ?? [];
    if (p.status === "accepted") {
      for (const m of ms) if (typeof m.importeTotal === "number") eurosEnJuego += m.importeTotal;
    }
    const sector = (p.business.category ?? "—").trim() || "—";
    const zona = (p.business.city ?? "—").trim() || "—";
    bySector[sector] = (bySector[sector] ?? 0) + 1;
    byZona[zona] = (byZona[zona] ?? 0) + 1;
  }
  const top = (rec: Record<string, number>) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ name: k, count: v }));

  return NextResponse.json({
    items,
    counts,
    metrics: {
      total: all.length,
      validationRate,
      eurosEnJuego: Math.round(eurosEnJuego),
      bySector: top(bySector),
      byZona: top(byZona)
    }
  });
});
