/**
 * Generación de imagen IA con BRAND del cliente para Sonia.
 *
 * Lo que hace generate-image.ts es muy potente pero pensado para
 * el flow de "EditorialPost". Sonia necesita una versión standalone:
 *
 *   - Recibe { clientId?, prompt, format }.
 *   - Si hay clientId, enriquece el prompt con brandBrief + colors +
 *     styleGuideCached del cliente.
 *   - Llama a OpenAI gpt-image-1 (o DALL-E 3 si no disponible).
 *   - Sube el binario a R2.
 *   - Devuelve { url, mimeType, sizeBytes } listo para attach.
 *
 * NO modifica la BD — el caller (executor de la tool) decide si
 * adjuntar a una task, asociar a un editorialPost, etc.
 */

import { prisma } from "@/lib/db/prisma";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";
import { uploadBuffer, buildS3Key, signedDownloadUrl, isStorageEnabled } from "@/lib/storage/r2";

export type BrandImageFormat = "square" | "story" | "landscape" | "portrait";

type Dimensions = { width: number; height: number };

const FORMAT_DIMS: Record<BrandImageFormat, Dimensions> = {
  square: { width: 1024, height: 1024 },
  story: { width: 1024, height: 1792 },
  landscape: { width: 1792, height: 1024 },
  portrait: { width: 1024, height: 1536 }
};

function pickOpenAiSize(width: number, height: number): "1024x1024" | "1024x1536" | "1536x1024" {
  if (width === height) return "1024x1024";
  if (width < height) return "1024x1536";
  return "1536x1024";
}

export async function generateBrandImage(opts: {
  workspaceId: string;
  clientId?: string | null;
  prompt: string;
  format?: BrandImageFormat;
  /** "low" (~$0.01) | "medium" (~$0.04) | "high" (~$0.12) */
  quality?: "low" | "medium" | "high";
  /** Si null, no se adjunta automáticamente — solo se sube a R2. */
  attachToTaskId?: string | null;
  uploadedByUserId?: string | null;
}): Promise<{
  fileId?: string;
  url: string;
  s3Key: string;
  mimeType: string;
  sizeBytes: number;
  finalPrompt: string;
}> {
  if (!isStorageEnabled()) {
    throw new Error("Storage no configurado. Define STORAGE_* en env.");
  }
  const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
  if (!apiKey) throw new Error("OpenAI key no configurada en el workspace");

  // Enriquecer prompt con brand si hay cliente.
  let finalPrompt = opts.prompt.trim();
  if (opts.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId, deletedAt: null } as any
    });
    if (client) {
      const brandParts: string[] = [];
      if (client.brandBrief?.trim()) {
        brandParts.push(`About the brand: ${client.brandBrief.slice(0, 400)}`);
      }
      brandParts.push(
        `Brand colors: primary ${client.brandColorPrimary}, accent ${client.brandColorAccent}.`
      );
      if (client.styleGuideCached?.trim()) {
        brandParts.push(`Brand style guide: ${client.styleGuideCached.slice(0, 1200)}`);
      }
      finalPrompt =
        finalPrompt +
        "\n\n" +
        brandParts.join("\n") +
        "\n\n" +
        `Editorial photographic realism, composition with ample empty negative space.\n` +
        `CRITICAL: no readable text, no letters, no numbers, no watermarks of any kind — ` +
        `text is composed separately afterwards.`;
    }
  }

  const format = opts.format ?? "square";
  const dim = FORMAT_DIMS[format];
  const size = pickOpenAiSize(dim.width, dim.height);
  const quality = opts.quality ?? "medium";

  // Llamada a OpenAI gpt-image-1 (sucesor de DALL-E 3).
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: finalPrompt.slice(0, 32_000),
      size,
      quality,
      n: 1
    })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI image ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no devolvió b64_json");
  const buf = Buffer.from(b64, "base64");

  // Subir a R2.
  const filename = `brand-img-${Date.now()}.png`;
  const s3Key = buildS3Key({
    workspaceId: opts.workspaceId,
    targetType: opts.attachToTaskId ? "TASK" : null,
    targetId: opts.attachToTaskId ?? null,
    filename
  });
  await uploadBuffer({ s3Key, body: buf, contentType: "image/png" });

  // Si se pidió attach, crear File + comentario.
  let fileId: string | undefined;
  if (opts.attachToTaskId) {
    const file = await prisma.file.create({
      data: {
        workspaceId: opts.workspaceId,
        name: filename,
        mimeType: "image/png",
        sizeBytes: buf.length,
        s3Key,
        targetType: "TASK",
        targetId: opts.attachToTaskId,
        uploadedBy: opts.uploadedByUserId ?? null
      }
    });
    fileId = file.id;
  }

  return {
    fileId,
    url: await signedDownloadUrl(s3Key),
    s3Key,
    mimeType: "image/png",
    sizeBytes: buf.length,
    finalPrompt
  };
}
