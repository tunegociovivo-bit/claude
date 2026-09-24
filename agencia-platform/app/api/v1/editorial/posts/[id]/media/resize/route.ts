import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { EDITORIAL_IMAGE_PRESETS, resizeEditorialImage } from "@/lib/editorial/media";

const schema = z.object({
  preview: z.boolean().optional(),
  preset: z.enum(Object.keys(EDITORIAL_IMAGE_PRESETS) as [keyof typeof EDITORIAL_IMAGE_PRESETS, ...(keyof typeof EDITORIAL_IMAGE_PRESETS)[]]).optional(),
  width: z.number().int().min(100).max(4096).optional(),
  height: z.number().int().min(100).max(4096).optional(),
  fit: z.enum(["cover", "contain", "fill"]).default("cover"),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff")
});

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const out = await resizeEditorialImage({
      workspaceId: api.workspaceId,
      userId: api.userId,
      postId: params.id,
      ...parsed.data
    });
    return NextResponse.json(out);
  } catch (error: any) {
    throw new ApiError(400, "resize_failed", String(error?.message ?? error));
  }
});
