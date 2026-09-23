/**
 * Freepik (Magnific) Seedream 4.5 — asíncrono: crear tarea → consultar estado.
 * Con referencias de estilo del cliente → /seedream-v4-5-edit (máx 5 reference_images, URLs públicas).
 * Sin referencias → /seedream-v4-5 (text-to-image).
 * La API key es la del calendario editorial (settings.editorial.freepikApiKey / FREEPIK_API_KEY).
 */
import { getFreepikKeyForWorkspace } from "@/lib/ai/freepik";
import type { SeoBlogSettings } from "./settings";

export async function createSeedreamTask(
  workspaceId: string,
  s: SeoBlogSettings,
  prompt: string,
  aspect: string,
  refUrls: string[]
): Promise<{ taskId: string; endpoint: string }> {
  const apiKey = await getFreepikKeyForWorkspace(workspaceId);
  const refs = refUrls.filter(Boolean).slice(0, 5);
  const endpoint = refs.length ? s.freepikEditPath : s.freepikT2iPath;
  const body: any = { prompt: prompt.slice(0, 4000), aspect_ratio: aspect || "widescreen_16_9" };
  if (refs.length) body.reference_images = refs;
  const r = await fetch(s.freepikBase.replace(/\/+$/, "") + endpoint, {
    method: "POST",
    headers: { [s.freepikHeader]: apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000)
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  const d = data?.data ?? data;
  if (!r.ok || !d?.task_id) throw new Error(`Freepik (${r.status}): ${text.slice(0, 300)}`);
  return { taskId: String(d.task_id), endpoint };
}

export async function checkSeedreamTask(
  workspaceId: string,
  s: SeoBlogSettings,
  endpoint: string,
  taskId: string
): Promise<{ status: string; urls: string[] }> {
  const apiKey = await getFreepikKeyForWorkspace(workspaceId);
  const r = await fetch(`${s.freepikBase.replace(/\/+$/, "")}${endpoint}/${encodeURIComponent(taskId)}`, {
    headers: { [s.freepikHeader]: apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Freepik estado (${r.status}): ${text.slice(0, 200)}`);
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {}
  const d = data?.data ?? data;
  const urls: string[] = [];
  for (const g of d?.generated ?? []) {
    if (typeof g === "string") urls.push(g);
    else if (g?.url) urls.push(String(g.url));
  }
  return { status: String(d?.status ?? "UNKNOWN").toUpperCase(), urls };
}
