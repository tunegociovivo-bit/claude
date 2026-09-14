import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { processSearchBatch, startSearch } from "@/lib/leads/search-manager";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  keyword: z.string().trim().min(2).max(120)
});

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const search = await startSearch({
    workspaceId: api.workspaceId,
    userId: api.userId,
    keyword: parsed.data.keyword,
    location: "",
    scope: "spain",
    source: "jobs",
    skipExisting: true,
    sourceConfig: { jobBoards: ["linkedin"] }
  });
  const result = await processSearchBatch({
    workspaceId: api.workspaceId,
    searchId: search.searchId,
    batchSize: 1
  });

  if (result.status === "FAILED") {
    throw new ApiError(502, "linkedin_jobs_search_failed", "LinkedIn Jobs no pudo completar el barrido. Revisa Scrapfly en Ajustes de Leads.");
  }

  return NextResponse.json({
    searchId: search.searchId,
    status: result.status,
    offersAdded: result.leadsInserted,
    duplicatesSkipped: result.leadsSkipped
  }, { status: 201 });
});
