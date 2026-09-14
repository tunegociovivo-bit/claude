import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { startSearch } from "@/lib/leads/search-manager";

export const dynamic = "force-dynamic";
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
  return NextResponse.json({
    searchId: search.searchId,
    status: "PENDING"
  }, { status: 202 });
});
