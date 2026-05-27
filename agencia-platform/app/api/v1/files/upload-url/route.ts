import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { isStorageEnabled, signedUploadUrl, buildS3Key } from "@/lib/storage/r2";

const requestSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(0).max(50 * 1024 * 1024), // 50 MB tope
  targetType: z.enum(["TASK", "DOCUMENT", "CLIENT", "PROJECT"]).optional(),
  targetId: z.string().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!isStorageEnabled()) {
    throw new ApiError(503, "storage_disabled", "Storage no configurado. Define STORAGE_* en variables de entorno.");
  }
  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { filename, contentType, targetType, targetId } = parsed.data;
  const s3Key = buildS3Key({
    workspaceId: api.workspaceId,
    targetType,
    targetId,
    filename
  });
  const url = await signedUploadUrl(s3Key, contentType);
  return NextResponse.json({ uploadUrl: url, s3Key, expiresIn: 300 });
});
