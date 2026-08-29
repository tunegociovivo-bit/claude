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
  website: z.string().trim().max(1000).optional().default("")
}).refine((row) => Boolean(row.linkedinUrl || row.email || row.phone), "Cada contacto necesita LinkedIn, email o teléfono");

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
    select: { email: true, phone: true, linkedinUrl: true }
  });
  const fingerprints = new Set(existing.flatMap((row) => [normalize(row.email ?? undefined), normalize(row.phone ?? undefined), normalize(row.linkedinUrl ?? undefined)].filter(Boolean)) as string[]);
  const accepted = [] as z.infer<typeof rowSchema>[];
  let duplicates = 0;
  for (const row of parsed.data.rows) {
    const keys = [normalize(row.email), normalize(row.phone), normalize(row.linkedinUrl)].filter(Boolean) as string[];
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
        status: campaign.status === "active" ? "active" : "pending",
        nextActionAt: campaign.status === "active" ? new Date() : null
      }))
    });
  }
  return NextResponse.json({ imported: accepted.length, duplicates, rejected: parsed.data.rows.length - accepted.length - duplicates });
});
