import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { listEditorialMetaProfiles, upsertEditorialMetaProfile } from "@/lib/editorial/meta-publishing";

const schema = z.object({
  clientId: z.string().min(1),
  metaConnectionId: z.string().optional().nullable(),
  label: z.string().min(1).max(120),
  facebookPageId: z.string().optional().nullable(),
  facebookPageName: z.string().optional().nullable(),
  instagramUserId: z.string().optional().nullable(),
  instagramName: z.string().optional().nullable(),
  active: z.boolean().optional()
});

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const items = await listEditorialMetaProfiles(api.workspaceId, clientId);
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const item = await upsertEditorialMetaProfile({ workspaceId: api.workspaceId, ...parsed.data });
    return NextResponse.json(item, { status: 201 });
  } catch (error: any) {
    throw new ApiError(400, "meta_profile_error", String(error?.message ?? error));
  }
});
