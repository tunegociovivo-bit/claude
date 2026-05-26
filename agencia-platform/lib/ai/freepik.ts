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

const FREEPIK_BASE = "https://api.freepik.com/v1/ai";

/**
 * Genera un VÍDEO a partir de una IMAGEN con Freepik (modelo Kling 2.0,
 * image-to-video). Async: envía la tarea, hace polling y devuelve la URL
 * del .mp4 generado. El slug del modelo es configurable (default kling-v2);
 * Freepik puede cambiarlo (kling-v2-1, kling-pro…), por eso es ajustable.
 *
 * Docs: https://docs.freepik.com → AI → Image to video.
 */
export async function generateFreepikKlingVideo(opts: {
  workspaceId: string;
  /** Imagen origen en base64 SIN prefijo data: */
  imageBase64: string;
  prompt: string;
  durationSeconds?: 5 | 10;
  modelSlug?: string;
}): Promise<{ url: string; model: string }> {
  const apiKey = await getFreepikKeyForWorkspace(opts.workspaceId);
  // Default: kling-v2 (slug conocido y estable de Freepik). Para usar la 2.5
  // u otra versión, configura FREEPIK_VIDEO_MODEL en Railway con el slug
  // exacto (p.ej. "kling-v2-5", "kling-v2-5-pro", "kling-v2-1-pro") — el
  // catálogo y los nombres exactos los publica Freepik en su API y cambian.
  const slug = opts.modelSlug ?? process.env.FREEPIK_VIDEO_MODEL ?? "kling-v2";
  const submit = await fetch(`${FREEPIK_BASE}/image-to-video/${slug}`, {
    method: "POST",
    headers: { "x-freepik-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      image: opts.imageBase64,
      prompt: opts.prompt.slice(0, 2000),
      duration: String(opts.durationSeconds ?? 5)
    })
  });
  if (!submit.ok) {
    const t = await submit.text();
    // 404 normalmente = slug del modelo no existe en Freepik. Mensaje claro
    // para que el usuario sepa qué configurar sin tener que abrir el repo.
    if (submit.status === 404) {
      throw new Error(
        `Freepik no conoce el modelo "${slug}". Configura FREEPIK_VIDEO_MODEL en Railway con un slug válido (p.ej. kling-v2, kling-v2-1-pro, kling-v2-5).`
      );
    }
    throw new Error(`Freepik vídeo submit ${submit.status} (modelo "${slug}"): ${t.slice(0, 300)}`);
  }
  const sub = await submit.json();
  const taskId = sub?.data?.task_id ?? sub?.data?.id ?? sub?.task_id;
  if (!taskId) throw new Error("Freepik no devolvió task_id de vídeo");

  const TIMEOUT_MS = 6 * 60 * 1000;
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 6000));
    const sr = await fetch(`${FREEPIK_BASE}/image-to-video/${slug}/${taskId}`, {
      headers: { "x-freepik-api-key": apiKey }
    });
    if (!sr.ok) continue;
    const s = await sr.json();
    const st = String(s?.data?.status ?? s?.status ?? "").toUpperCase();
    if (st === "COMPLETED" || st === "DONE" || st === "SUCCESS") {
      const gen = s?.data?.generated ?? s?.data?.result ?? s?.generated;
      const url = Array.isArray(gen) ? gen[0] : typeof gen === "string" ? gen : gen?.url;
      if (!url) throw new Error("Freepik vídeo COMPLETED pero sin URL de resultado");
      return { url: String(url), model: slug };
    }
    if (st === "FAILED" || st === "ERROR") {
      throw new Error(`Freepik vídeo falló: ${JSON.stringify(s?.data ?? s).slice(0, 200)}`);
    }
  }
  throw new Error(`Freepik vídeo: timeout tras ${TIMEOUT_MS / 1000}s`);
}

