import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prepareEditorialPublications, publishEditorialPublication } from "@/lib/editorial/meta-publishing";

const schema = z.object({
  profileId: z.string().optional().nullable(),
  networks: z.array(z.enum(["facebook", "instagram"])).optional(),
  schedule: z.boolean().default(false),
  publishNow: z.boolean().default(false)
});

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const prepared = await prepareEditorialPublications({
      workspaceId: api.workspaceId,
      postId: params.id,
      profileId: parsed.data.profileId,
      networks: parsed.data.networks,
      schedule: parsed.data.schedule
    });
    if (!parsed.data.publishNow) return NextResponse.json({ items: prepared });
    const published = [];
    for (const item of prepared) {
      published.push(await publishEditorialPublication(api.workspaceId, item.id));
    }
    return NextResponse.json({ items: published });
  } catch (error: any) {
    throw new ApiError(400, "publish_meta_failed", String(error?.message ?? error));
  }
});
