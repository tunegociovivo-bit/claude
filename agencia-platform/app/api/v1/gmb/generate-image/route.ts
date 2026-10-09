/**
 * POST /api/v1/gmb/generate-image → genera una imagen para una publicación de Google con
 * gpt-image-1 (DALL·E 3 ya no está disponible en OpenAI). Body: { prompt }. Devuelve { url }.
 * La imagen se guarda en el almacenamiento del Hub y se sirve por una URL pública firmada y
 * permanente, para que Google pueda descargarla al publicar.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";
import { isStorageEnabled, uploadBuffer } from "@/lib/storage/r2";
import { publicMediaUrl } from "@/lib/bubui/public-media";
import { publicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({ prompt: z.string().min(3).max(1000) });

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (!isStorageEnabled()) throw new ApiError(500, "no_storage", "El almacenamiento de archivos del Hub no está configurado.");

  let apiKey: string;
  try {
    apiKey = await getOpenAiKeyForWorkspace(api.workspaceId);
  } catch (e: any) {
    throw new ApiError(400, "no_openai_key", String(e?.message ?? e));
  }

  const prompt =
    `${parsed.data.prompt.trim()}\n\n` +
    "Fotografía realista y profesional para una publicación de Google Business Profile de un negocio local: " +
    "luz natural, composición limpia, colores naturales. Sin texto, letras, números, logotipos ni marcas de agua.";

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(110_000),
    body: JSON.stringify({ model: "gpt-image-1", prompt, n: 1, size: "1536x1024", quality: "medium" })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new ApiError(502, "ai_error", `OpenAI ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new ApiError(502, "ai_error", "OpenAI no devolvió imagen");

  const key = `gmb/post-image/${api.workspaceId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  await uploadBuffer({ s3Key: key, body: Buffer.from(b64, "base64"), contentType: "image/png" });
  const url = publicMediaUrl(publicBaseUrl(req), key);
  return NextResponse.json({ url });
});
