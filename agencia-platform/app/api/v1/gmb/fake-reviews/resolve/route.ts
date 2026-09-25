/** POST /api/v1/gmb/fake-reviews/resolve {q} → ficha de Google Maps (o candidatos) vía SerpApi o Serper. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { resolvePlace } from "@/lib/gmb/fake-reviews/job";
import { getReviewSource, NoReviewSourceError } from "@/lib/gmb/fake-reviews/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ q: z.string().min(2).max(2000) });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  let source;
  try {
    source = await getReviewSource(api.workspaceId);
  } catch (e) {
    if (e instanceof NoReviewSourceError) throw new ApiError(412, "no_review_source", e.message);
    throw e;
  }
  try {
    return NextResponse.json(await resolvePlace(source, parsed.data.q));
  } catch (e) {
    throw new ApiError(422, "not_resolved", (e as Error).message);
  }
});
