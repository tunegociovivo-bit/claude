/**
 * POST /api/v1/meta/campaigns/[id]/assets
 *   multipart: file (Blob), kind ("logo" | "reference")
 *
 * Sube un fichero (logo o imagen de referencia) a R2 y lo registra
 * en la campaña. Para "logo": reemplaza campaign.logoUrl. Para
 * "reference": añade a campaign.referenceImageUrls (máx 5).
 *
 * DELETE /api/v1/meta/campaigns/[id]/assets
 *   body: { kind: "logo" } | { kind: "reference", url: string }
 *   Elimina el logo o una referencia concreta de la campaña.
 *   El blob en R2 NO se borra (es batch separado por coste).
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { buildS3Key, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB por asset
const MAX_REFERENCES = 5;

export const POST = withApi({ scope: "*", rate: "destructive" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  if (!isStorageEnabled()) {
    throw new ApiError(500, "no_storage", "Almacenamiento R2 no configurado");
  }

  const campaign = await prisma.metaCampaign.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");

  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "bad_multipart", "Se esperaba multipart/form-data");
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "reference");
  if (!(file instanceof Blob)) throw new ApiError(400, "no_file", "Falta el campo 'file'");
  if (file.size === 0) throw new ApiError(400, "empty", "Fichero vacío");
  if (file.size > MAX_BYTES) {
    throw new ApiError(413, "too_large", `Máximo ${MAX_BYTES / 1024 / 1024} MB por fichero`);
  }
  if (kind !== "logo" && kind !== "reference") {
    throw new ApiError(400, "bad_kind", `kind debe ser 'logo' o 'reference', recibido '${kind}'`);
  }

  const contentType = file.type || "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    throw new ApiError(400, "not_image", "Solo se aceptan imágenes (jpeg/png/webp/svg)");
  }
  const filename = (file as any).name || `${kind}-${Date.now()}.png`;

  // Para referencias: comprobamos el cap antes de subir.
  if (kind === "reference") {
    const current = (campaign.referenceImageUrls ?? []).length;
    if (current >= MAX_REFERENCES) {
      throw new ApiError(
        400,
        "too_many_references",
        `Máximo ${MAX_REFERENCES} imágenes de referencia. Borra alguna antes de subir más.`
      );
    }
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const s3Key = buildS3Key({
    workspaceId: api.workspaceId,
    targetType: "meta_campaign",
    targetId: campaign.id,
    filename: `${kind}-${filename}`
  });
  await uploadBuffer({ s3Key, body: buf, contentType });
  const url = await signedDownloadUrl(s3Key);

  if (kind === "logo") {
    await prisma.metaCampaign.update({
      where: { id: campaign.id },
      data: { logoUrl: url }
    });
  } else {
    await prisma.metaCampaign.update({
      where: { id: campaign.id },
      data: {
        referenceImageUrls: { set: [...(campaign.referenceImageUrls ?? []), url] }
      }
    });
  }

  return NextResponse.json({ ok: true, url, kind });
});

const deleteSchema = z.union([
  z.object({ kind: z.literal("logo") }),
  z.object({ kind: z.literal("reference"), url: z.string().min(1) })
]);

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const campaign = await prisma.metaCampaign.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");

  if (parsed.data.kind === "logo") {
    await prisma.metaCampaign.update({
      where: { id: campaign.id },
      data: { logoUrl: null }
    });
  } else {
    const urlToRemove = parsed.data.url;
    await prisma.metaCampaign.update({
      where: { id: campaign.id },
      data: {
        referenceImageUrls: {
          set: (campaign.referenceImageUrls ?? []).filter((u) => u !== urlToRemove)
        }
      }
    });
  }
  return NextResponse.json({ ok: true });
});
