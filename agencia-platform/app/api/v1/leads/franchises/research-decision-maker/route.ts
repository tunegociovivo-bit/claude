import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { findMarketingEmailsByDomain } from "@/lib/leads/enrich-contacts";
import { rankFranchiseDecisionMakers } from "@/lib/leads/franchise-decision-maker";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().min(1) });

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const lead = await prisma.lead.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId },
    select: { id: true, name: true, website: true, rawData: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Cuenta de franquicia no encontrada");
  const raw: any = lead.rawData ?? {};
  const domain = String(lead.website ?? raw.website ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!domain) throw new ApiError(400, "missing_domain", "No hay un dominio corporativo con el que investigar al decisor");

  const candidates = await findMarketingEmailsByDomain(api.workspaceId, domain, 20, raw.brand ?? lead.name);
  const ranked = rankFranchiseDecisionMakers(candidates, domain);
  const selected = ranked.find((candidate) => candidate.sendAllowed) ?? null;
  const copies = selected ? ranked.filter((candidate) => candidate.email !== selected.email && candidate.copyAllowed).slice(0, 4) : [];
  const now = new Date().toISOString();
  const research = { status: selected ? "verified" : "pending", selected, copies, candidates: ranked.slice(0, 20), researchedAt: now };
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      email: selected?.email ?? null,
      rawData: {
        ...raw,
        email: selected?.email ?? undefined,
        directorName: selected?.name ?? undefined,
        directorRole: selected?.role ?? undefined,
        linkedin: selected?.linkedin ?? undefined,
        decisionMakerResearch: research
      }
    }
  });
  return NextResponse.json({ ok: true, research });
});
