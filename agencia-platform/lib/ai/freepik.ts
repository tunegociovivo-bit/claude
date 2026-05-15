/**
 * Cliente Freepik para generación de imágenes (alternativa más barata
 * que gpt-image-1). Usa el endpoint v1/ai/text-to-image (modelo
 * seedream-v4 por defecto).
 *
 * Auth: header `x-freepik-api-key`. Configurada en
 * workspace.settings.editorial.freepikApiKey (cifrada con la misma
 * crypto que el resto de keys).
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "./crypto";
import { AIDisabledError } from "./anthropic";

export async function getFreepikKeyForWorkspace(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = ws?.settings ?? {};
  const encrypted: string | undefined = settings?.editorial?.freepikApiKey;
  let apiKey: string | null = null;
  if (encrypted) apiKey = decryptSecret(encrypted);
  if (!apiKey) apiKey = process.env.FREEPIK_API_KEY ?? null;
  if (!apiKey) {
    throw new AIDisabledError(
      "No hay API key de Freepik. Configúrala en /admin/editorial o en la variable FREEPIK_API_KEY."
    );
  }
  return apiKey;
}

export type FreepikSize = "square" | "portrait" | "landscape";

export function pickFreepikSize(width: number, height: number): FreepikSize {
  const r = width / height;
  if (r > 1.2) return "landscape";
  if (r < 0.83) return "portrait";
  return "square";
}

/**
 * Genera una imagen con Freepik. Devuelve un Buffer PNG.
 */
export async function generateFreepikImage(opts: {
  workspaceId: string;
  prompt: string;
  size: FreepikSize;
}): Promise<Buffer> {
  const apiKey = await getFreepikKeyForWorkspace(opts.workspaceId);
  const r = await fetch("https://api.freepik.com/v1/ai/text-to-image", {
    method: "POST",
    headers: {
      "x-freepik-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      image: { size: opts.size },
      num_inference_steps: 25,
      guidance_scale: 2.0
    })
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Freepik ${r.status}: ${txt.slice(0, 300)}`);
  }
  const data = await r.json();
  const b64 = data?.data?.[0]?.base64;
  if (!b64) throw new Error("Freepik no devolvió imagen base64 esperada");
  return Buffer.from(b64, "base64");
}
