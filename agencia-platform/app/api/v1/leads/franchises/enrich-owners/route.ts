import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { researchFranchiseOwner } from "@/lib/leads/franchise-owner-enrichment";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({ searchId: z.string().optional(), ids: z.array(z.string()).max(20).optional(), limit: z.number().int().min(1).max(20).default(5), force: z.boolean().optional() });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (!parsed.data.searchId && !parsed.data.ids?.length) throw new ApiError(400, "missing_target", "Selecciona una búsqueda o leads concretos");
  const leads = await prisma.lead.findMany({
    where: { workspaceId: api.workspaceId, ...(parsed.data.searchId ? { searchId: parsed.data.searchId } : {}), ...(parsed.data.ids?.length ? { id: { in: parsed.data.ids } } : {}) },
    select: { id: true, name: true, address: true, province: true, website: true, email: true, rawData: true },
    take: parsed.data.limit,
  });
  const candidates = leads.filter((lead) => (lead.rawData as any)?.source === "brand_locations" && (parsed.data.force || !(lead.rawData as any)?.franchiseOwner));
  const items: any[] = [];
  for (const lead of candidates) {
    const raw: any = lead.rawData ?? {};
    const owner = await researchFranchiseOwner({ workspaceId: api.workspaceId, brand: String(raw.brand ?? lead.name), storeName: lead.name, address: lead.address, province: lead.province, centralWebsite: lead.website });
    const nextRaw = { ...raw, franchiseOwner: owner };
    // NUNCA sobrescribir un email ya existente: solo se rellena si el lead no tenía. La
    // escritura va tenant-scoped (updateMany con workspaceId) como defensa en profundidad.
    const fillEmail = !lead.email && owner.emails[0] ? owner.emails[0] : undefined;
    await prisma.lead.updateMany({
      where: { id: lead.id, workspaceId: api.workspaceId },
      data: { rawData: nextRaw, ...(fillEmail ? { email: fillEmail } : {}) }
    });
    items.push({ id: lead.id, name: lead.name, ...owner });
  }
  return NextResponse.json({ ok: true, scanned: leads.length, enriched: items.length, items, remainingHint: leads.length >= parsed.data.limit });
});
