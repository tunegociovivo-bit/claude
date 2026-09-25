/** POST /api/v1/gmb/fake-reviews/resolve {q} → ficha de Google Maps (o candidatos) vía SerpApi. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { SerpApiClient, getSerpApiKey, SerpApiKeyMissingError } from "@/lib/integrations/serpapi";
import { resolvePlace } from "@/lib/gmb/fake-reviews/job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ q: z.string().min(2).max(2000) });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const key = await getSerpApiKey(api.workspaceId);
  if (!key) throw new ApiError(412, "serpapi_missing", new SerpApiKeyMissingError().message);
  try {
    const res = await resolvePlace(new SerpApiClient(key), parsed.data.q);
    return NextResponse.json(res);
  } catch (e) {
    throw new ApiError(422, "not_resolved", (e as Error).message);
  }
});
