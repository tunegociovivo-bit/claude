import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { signedDownloadUrl, isStorageEnabled } from "@/lib/storage/r2";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(0).max(50 * 1024 * 1024),
  s3Key: z.string().min(1),
  targetType: z.enum(["TASK", "DOCUMENT", "CLIENT", "PROJECT"]).optional(),
  targetId: z.string().optional()
});

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const targetType = url.searchParams.get("targetType") ?? undefined;
  const targetId = url.searchParams.get("targetId") ?? undefined;

  if (targetType === "SUBVENCION_VAULT") await requireVaultAdmin(api.workspaceId, api.userId);

  const where: any = { workspaceId: api.workspaceId };
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;

  const items = await prisma.file.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });

  // Adjuntamos URLs firmadas/públicas. Caso especial: archivos
  // importados de Asana como "externos" (gdrive/dropbox) tienen
  // s3Key con prefijo "__external__:<url>"; no hay binario en R2 —
  // devolvemos directamente la URL externa para que el cliente la
  // abra al hacer click.
  const enriched = await Promise.all(
    items.map(async (f) => ({
      ...f,
      url: await resolveFileUrl(f.s3Key),
      isExternal: f.s3Key.startsWith("__external__:")
    }))
  );

  return NextResponse.json({ items: enriched });
});

async function resolveFileUrl(s3Key: string): Promise<string | null> {
  if (s3Key.startsWith("__external__:")) {
    return s3Key.slice("__external__:".length) || null;
  }
  if (!isStorageEnabled()) return null;
  return signedDownloadUrl(s3Key);
}

async function requireVaultAdmin(workspaceId: string, userId?: string) {
  if (!userId) throw new ApiError(401, "unauthorized", "Autenticación requerida");
  const membership = await prisma.membership.findFirst({
    where: { workspaceId, userId },
    select: { role: true }
  });
  if (membership?.role !== "ADMIN") throw new ApiError(403, "forbidden", "Acceso restringido a administradores");
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const file = await prisma.file.create({
    data: {
      workspaceId: api.workspaceId,
      name: parsed.data.name,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      s3Key: parsed.data.s3Key,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      uploadedBy: api.userId
    }
  });
  return NextResponse.json(
    {
      ...file,
      url: await resolveFileUrl(file.s3Key),
      isExternal: file.s3Key.startsWith("__external__:")
    },
    { status: 201 }
  );
});
