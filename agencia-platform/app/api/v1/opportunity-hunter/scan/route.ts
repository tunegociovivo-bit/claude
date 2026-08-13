import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { scanCommercialOpportunities } from "@/lib/opportunity-hunter/scanner";

const schema = z.object({ region: z.string().trim().max(120).optional(), maxResults: z.number().int().min(1).max(40).optional() });
export const POST = withApi({ scope: "*", rate: "ai", admin: true }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const result = await scanCommercialOpportunities(prisma, api.workspaceId, parsed.data);
  return NextResponse.json({ ok: true, ...result });
});
