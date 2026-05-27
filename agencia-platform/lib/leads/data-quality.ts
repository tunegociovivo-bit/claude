/**
 * Data quality: re-scoring batch + validación WhatsApp batch.
 */

import { prisma } from "@/lib/db/prisma";
import { scoreLead } from "./scorer";
import { checkNumbers, normalizePhone } from "./waha";

export async function rescoreAll(opts: {
  workspaceId: string;
  limit?: number;
}): Promise<{ rescored: number }> {
  const leads = await prisma.lead.findMany({
    where: { workspaceId: opts.workspaceId },
    include: { competitors: { orderBy: { position: "asc" }, take: 1 } },
    take: opts.limit ?? 500
  });
  let n = 0;
  for (const l of leads) {
    const sc = scoreLead({
      businessStatus: l.businessStatus,
      rating: l.rating,
      reviewsCount: l.reviewsCount,
      negativePct: l.negativePct,
      position: l.position,
      website: l.website,
      competitorTopRating: l.competitors[0]?.rating ?? null
    });
    await prisma.lead.update({
      where: { id: l.id },
      data: { score: sc.score, urgency: sc.urgency, scoreBreakdown: sc.breakdown }
    });
    n++;
  }
  return { rescored: n };
}

export async function validatePendingWhatsapp(opts: {
  workspaceId: string;
  limit?: number;
}): Promise<{ checked: number; withWa: number; withoutWa: number }> {
  const ws = await prisma.workspace.findUnique({ where: { id: opts.workspaceId } });
  const countryCode: string = (ws?.settings as any)?.leads?.whatsappCountryCode ?? "34";

  const leads = await prisma.lead.findMany({
    where: {
      workspaceId: opts.workspaceId,
      whatsappChecked: false,
      OR: [{ phone: { not: null } }, { internationalPhone: { not: null } }]
    },
    take: opts.limit ?? 50,
    select: { id: true, phone: true, internationalPhone: true }
  });

  const phoneByLead = new Map<string, string>(); // leadId → phoneNormalized
  for (const l of leads) {
    const raw = l.internationalPhone ?? l.phone ?? "";
    const norm = normalizePhone(raw, countryCode);
    if (norm) phoneByLead.set(l.id, norm);
  }
  if (phoneByLead.size === 0) return { checked: 0, withWa: 0, withoutWa: 0 };

  const phones = Array.from(new Set(phoneByLead.values()));
  const result = await checkNumbers({ workspaceId: opts.workspaceId, phones });

  let withWa = 0;
  let withoutWa = 0;
  const now = new Date();
  for (const [leadId, phone] of phoneByLead.entries()) {
    const has = !!result[phone];
    if (has) withWa++;
    else withoutWa++;
    await prisma.lead.update({
      where: { id: leadId },
      data: { hasWhatsapp: has, whatsappChecked: true, whatsappCheckedAt: now }
    });
  }
  return { checked: phoneByLead.size, withWa, withoutWa };
}

export async function findDuplicateGroups(opts: {
  workspaceId: string;
  limit?: number;
}): Promise<{ placeId: string; count: number; leadIds: string[] }[]> {
  // Group by placeId. Como tenemos UNIQUE(workspaceId, placeId), no
  // deberían existir, pero el legacy data podría tenerlos.
  const rows = await prisma.$queryRaw<{ placeId: string; count: bigint }[]>`
    SELECT "placeId", COUNT(*) as count FROM "Lead"
    WHERE "workspaceId" = ${opts.workspaceId} AND "placeId" IS NOT NULL
    GROUP BY "placeId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT ${opts.limit ?? 50}
  `;
  const out: { placeId: string; count: number; leadIds: string[] }[] = [];
  for (const r of rows) {
    const leads = await prisma.lead.findMany({
      where: { workspaceId: opts.workspaceId, placeId: r.placeId },
      select: { id: true }
    });
    out.push({ placeId: r.placeId, count: Number(r.count), leadIds: leads.map((l) => l.id) });
  }
  return out;
}
