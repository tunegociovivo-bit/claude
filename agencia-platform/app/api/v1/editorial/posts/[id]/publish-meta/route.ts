import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prepareEditorialPublications, publishEditorialPublication } from "@/lib/editorial/meta-publishing";

const schema = z.object({
  profileId: z.string().optional().nullable(),
  destinations: z.array(z.object({ profileId: z.string().min(1), networks: z.array(z.enum(["facebook", "instagram"])).min(1) })).min(1).max(20).optional(),
  networks: z.array(z.enum(["facebook", "instagram"])).optional(),
  schedule: z.boolean().default(false),
  publishNow: z.boolean().default(false)
  ,mediaUrls: z.array(z.string().url()).max(10).optional()
});

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (parsed.data.schedule && parsed.data.publishNow) throw new ApiError(400, "validation_error", "Elige publicar ahora o programar.");
  try {
    const prepared = [];
    for (const destination of parsed.data.destinations ?? [{ profileId: parsed.data.profileId, networks: parsed.data.networks }]) prepared.push(...await prepareEditorialPublications({
      workspaceId: api.workspaceId,
      postId: params.id,
      profileId: destination.profileId,
      networks: destination.networks,
      schedule: parsed.data.schedule
      ,mediaUrls: parsed.data.mediaUrls
    }));
    if (!parsed.data.publishNow) return NextResponse.json({ items: prepared });
    const published = [];
    const errors = [];
    for (const item of prepared) {
      try { published.push(await publishEditorialPublication(api.workspaceId, item.id)); }
      catch (error) { errors.push({ id: item.id, message: error instanceof Error ? error.message : "Error de publicación" }); }
    }
    return NextResponse.json({ items: published, errors });
  } catch (error: any) {
    throw new ApiError(400, "publish_meta_failed", String(error?.message ?? error));
  }
});
