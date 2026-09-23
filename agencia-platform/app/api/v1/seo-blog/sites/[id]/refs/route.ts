import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { signedDownloadUrl, isStorageEnabled } from "@/lib/storage/r2";
import { storeReference } from "@/lib/seo-blog/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function list(workspaceId: string, siteId: string) {
  const refs = await prisma.seoBlogRef.findMany({ where: { workspaceId, siteId }, orderBy: { createdAt: "asc" } });
  return Promise.all(refs.map(async (r) => ({ id: r.id, label: r.label, width: r.width, height: r.height, url: await signedDownloadUrl(r.s3Key, 3600).catch(() => "") })));
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  return NextResponse.json({ items: isStorageEnabled() ? await list(api.workspaceId, params.id) : [], storage: isStorageEnabled() });
});

/** Subida multipart (campo "file", una imagen por petición). Se guarda redimensionada (≤1800 px, JPEG q82). */
export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await prisma.seoBlogSite.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new ApiError(400, "no_file", "No se recibió ningún archivo");
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new ApiError(400, "bad_type", "Formato no admitido (JPG, PNG o WEBP)");
  if (file.size > 15 * 1024 * 1024) throw new ApiError(400, "too_big", "La imagen supera 15 MB");
  try {
    await storeReference(api.workspaceId, site.id, Buffer.from(await file.arrayBuffer()), file.name, String(form?.get("label") ?? ""));
  } catch (e: any) {
    throw new ApiError(400, "upload_failed", e?.message ?? "No se pudo guardar la imagen");
  }
  return NextResponse.json({ items: await list(api.workspaceId, site.id) });
});
