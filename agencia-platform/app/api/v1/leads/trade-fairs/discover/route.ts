import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { searchUpcomingTradeFairs } from "@/lib/leads/trade-fair-search";

export const dynamic = "force-dynamic";
const schema = z.object({ keyword: z.string().max(100).optional(), organizer: z.string().max(100).optional(), max: z.number().int().min(1).max(200).optional() });
export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({}))); if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  return NextResponse.json({ ok: true, ...(await searchUpcomingTradeFairs(api.workspaceId, parsed.data)) });
});
