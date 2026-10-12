import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { runInternalInstagramScan } from "@/lib/instagram-prospector/internal-scan";

export const dynamic = "force-dynamic";

const schema = z.object({
  sourceType: z.enum(["followers", "likers", "comments", "hashtag", "location"]),
  target: z.string().trim().min(2).max(5000),
  limit: z.number().int().min(1).max(1000),
  country: z.string().trim().max(80).default("Espana"),
  requiredSignalCount: z.number().int().min(1).max(8).default(2),
  requireIntentSignal: z.boolean().default(true),
  emailKeywords: z.string().max(2000).default(""),
  intentSignals: z.string().max(4000).default(""),
  negativeFilters: z.string().max(4000).default("")
});

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const result = await runInternalInstagramScan(parsed.data);
  return NextResponse.json(result);
});
