import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { ingestLinkedInJobOpportunity } from "@/lib/leads/job-opportunity-pipeline";

function isLinkedInPath(value: string, path: RegExp) {
  try {
    const url = new URL(value);
    return /(^|\.)linkedin\.com$/i.test(url.hostname) && path.test(url.pathname);
  } catch {
    return false;
  }
}

const linkedInJobUrl = z.string().trim().url().max(2000)
  .refine((value) => isLinkedInPath(value, /^\/jobs\/view\/\d+/i), "La oferta debe ser un enlace de LinkedIn Jobs");
const linkedInCompanyUrl = z.string().trim().url().max(2000)
  .refine((value) => isLinkedInPath(value, /^\/company\//i), "La empresa debe ser un enlace de LinkedIn");

const schema = z.object({
  company: z.string().trim().min(2).max(240),
  jobTitle: z.string().trim().min(2).max(300),
  location: z.string().trim().max(300).optional().nullable(),
  jobUrl: linkedInJobUrl,
  companyUrl: linkedInCompanyUrl.optional().nullable(),
  description: z.string().trim().max(12000).optional().nullable()
});

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const result = await ingestLinkedInJobOpportunity(api.workspaceId, {
    company: parsed.data.company,
    jobTitle: parsed.data.jobTitle,
    location: parsed.data.location || null,
    jobUrl: parsed.data.jobUrl,
    companyUrl: parsed.data.companyUrl || null,
    description: parsed.data.description || null,
    board: "linkedin"
  });
  if (!result.accepted) throw new ApiError(422, "job_not_relevant", result.reason);
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
});
