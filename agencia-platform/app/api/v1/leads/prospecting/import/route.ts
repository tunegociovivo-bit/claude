import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const rowSchema = z.object({
  firstName: z.string().trim().max(120).optional().default(""),
  lastName: z.string().trim().max(120).optional().default(""),
  companyName: z.string().trim().max(240).optional().default(""),
  jobTitle: z.string().trim().max(240).optional().default(""),
  linkedinUrl: z.string().trim().max(1000).optional().default(""),
  email: z.string().trim().max(320).optional().default(""),
  phone: z.string().trim().max(80).optional().default(""),
  website: z.string().trim().max(1000).optional().default(""),
  sourceKey: z.string().trim().max(500).optional().default(""),
  sourceType: z.enum(["linkedin_search", "sales_navigator", "linkedin_group", "linkedin_event", "linkedin_engagement"]).optional(),
  sourceUrl: z.string().trim().max(2000).optional().default("")
}).refine((row) => Boolean(row.linkedinUrl || row.email || row.phone || row.sourceKey), "Cada contacto necesita LinkedIn, email, teléfono o un identificador de origen");

const bodySchema = z.object({ campaignId: z.string().min(1), rows: z.array(rowSchema).min(1).max(5000) });

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() || null;
}

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const campaign = await prisma.prospectingCampaign.findFirst({
    where: { id: parsed.data.campaignId, workspaceId: api.workspaceId }
  });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");

  const existing = await prisma.prospectingProspect.findMany({
    where: { workspaceId: api.workspaceId },
    select: { email: true, phone: true, linkedinUrl: true, metadata: true }
  });
  const fingerprints = new Set(existing.flatMap((row) => {
    const metadata = (row.metadata || {}) as { sourceKey?: string };
    return [normalize(row.email ?? undefined), normalize(row.phone ?? undefined), normalize(row.linkedinUrl ?? undefined), metadata.sourceKey ? `source:${normalize(metadata.sourceKey)}` : null].filter(Boolean);
  }) as string[]);
  const accepted = [] as z.infer<typeof rowSchema>[];
  let duplicates = 0;
  for (const row of parsed.data.rows) {
    const keys = [normalize(row.email), normalize(row.phone), normalize(row.linkedinUrl), row.sourceKey ? `source:${normalize(row.sourceKey)}` : null].filter(Boolean) as string[];
    if (keys.some((key) => fingerprints.has(key))) { duplicates++; continue; }
    keys.forEach((key) => fingerprints.add(key));
    accepted.push(row);
  }

  if (accepted.length) {
    await prisma.prospectingProspect.createMany({
      data: accepted.map((row) => ({
        workspaceId: api.workspaceId,
        campaignId: campaign.id,
        firstName: row.firstName || null,
        lastName: row.lastName || null,
        companyName: row.companyName || null,
        jobTitle: row.jobTitle || null,
        linkedinUrl: row.linkedinUrl || null,
        email: row.email || null,
        phone: row.phone || null,
        website: row.website || null,
        metadata: { source: row.sourceType || "linkedin_search", sourceKey: row.sourceKey || undefined, sourceUrl: row.sourceUrl || undefined, capturedAt: new Date().toISOString(), profileResolved: Boolean(row.linkedinUrl) },
        status: row.linkedinUrl || row.email || row.phone ? (campaign.status === "active" ? "active" : "pending") : "pending_resolution",
        nextActionAt: row.linkedinUrl || row.email || row.phone ? (campaign.status === "active" ? new Date() : null) : null
      }))
    });
  }
  return NextResponse.json({ imported: accepted.length, duplicates, rejected: parsed.data.rows.length - accepted.length - duplicates });
});
