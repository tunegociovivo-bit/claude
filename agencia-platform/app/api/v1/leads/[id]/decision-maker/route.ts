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
import { decryptSecret } from "@/lib/ai/crypto";
import { buildDecisionMakerKit, type Director } from "@/lib/leads/decision-maker";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const [lead, ws] = await Promise.all([
    prisma.lead.findFirst({
      where: { id: params.id, workspaceId: api.workspaceId },
      select: { id: true, name: true, website: true, province: true, category: true, rawData: true, email: true }
    }),
    prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } })
  ]);
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  const raw: any = lead.rawData ?? {};
  const directors: Director[] = Array.isArray(raw.directors)
    ? raw.directors.filter((d: any) => d?.name).map((d: any) => ({ role: String(d.role ?? "Cargo"), name: String(d.name) }))
    : [];

  // Keys de enriquecimiento: env primero, si no, Ajustes del workspace (cifradas).
  const leadsCfg: any = (ws?.settings as any)?.leads ?? {};
  const apolloKey = process.env.APOLLO_API_KEY || (leadsCfg.apolloApiKeyEnc ? decryptSecret(leadsCfg.apolloApiKeyEnc) : null);
  const hunterKey = process.env.HUNTER_API_KEY || (leadsCfg.hunterApiKeyEnc ? decryptSecret(leadsCfg.hunterApiKeyEnc) : null);

  const kit = await buildDecisionMakerKit({
    workspaceId: api.workspaceId,
    company: lead.name,
    website: lead.website,
    province: lead.province,
    sector: lead.category,
    directors,
    apolloKey,
    hunterKey
  });

  // Guarda el mejor email en el lead (para la lista de remarketing) si no tenía.
  const bestEmail = kit.websiteEmails[0] ?? kit.found.find((p) => p.email)?.email ?? null;
  if (bestEmail && !lead.email) {
    void prisma.lead.update({ where: { id: lead.id }, data: { email: bestEmail } }).catch(() => {});
  }

  return NextResponse.json({ ok: true, ...kit });
});
