/**
 * POST /api/v1/leads/[id]/decision-maker
 *
 * Devuelve el "kit para contactar al directivo" de la empresa del lead:
 * cargos (del BORME), correos corporativos probables, enlace de LinkedIn para
 * localizar a la persona y un primer mensaje de nivel ejecutivo redactado por
 * la IA. Vía profesional y legal — no inventa datos personales privados.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildDecisionMakerKit, type Director } from "@/lib/leads/decision-maker";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const lead = await prisma.lead.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, name: true, website: true, province: true, category: true, rawData: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  const raw: any = lead.rawData ?? {};
  const directors: Director[] = Array.isArray(raw.directors)
    ? raw.directors.filter((d: any) => d?.name).map((d: any) => ({ role: String(d.role ?? "Cargo"), name: String(d.name) }))
    : [];

  const kit = await buildDecisionMakerKit({
    workspaceId: api.workspaceId,
    company: lead.name,
    website: lead.website,
    province: lead.province,
    sector: lead.category,
    directors
  });

  return NextResponse.json({ ok: true, ...kit });
});
