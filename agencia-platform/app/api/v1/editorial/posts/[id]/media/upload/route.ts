import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { attachEditorialImage } from "@/lib/editorial/media";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "missing_file", "Sube una imagen.");
  try {
    const out = await attachEditorialImage({
      workspaceId: api.workspaceId,
      userId: api.userId,
      postId: params.id,
      file
    });
    return NextResponse.json(out);
  } catch (error: any) {
    throw new ApiError(400, "upload_failed", String(error?.message ?? error));
  }
});
