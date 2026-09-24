/**
 * Freepik (Magnific) Seedream 4.5 — asíncrono: crear tarea → consultar estado.
 * Con referencias de estilo del cliente → /seedream-v4-5-edit (máx 5 reference_images, URLs públicas).
 * Sin referencias → /seedream-v4-5 (text-to-image).
 * La API key es la del calendario editorial (settings.editorial.freepikApiKey / FREEPIK_API_KEY).
 */
import { getFreepikKeyForWorkspace } from "@/lib/ai/freepik";
import type { SeoBlogSettings } from "./settings";

/** Freepik y Magnific son la misma API con dos hosts/cabeceras; probamos la configurada y, si falla la auth, la otra. */
const HOSTS: Array<{ base: string; header: string }> = [
  { base: "https://api.freepik.com", header: "x-freepik-api-key" },
  { base: "https://api.magnific.com", header: "x-magnific-api-key" }
];
let preferred: { base: string; header: string } | null = null;

function candidates(s: SeoBlogSettings) {
  const cfg = { base: s.freepikBase.replace(/\/+$/, ""), header: s.freepikHeader };
  const list = [cfg, ...HOSTS.filter((h) => h.base !== cfg.base)];
  if (preferred) list.sort((a, b) => (a.base === preferred!.base ? -1 : b.base === preferred!.base ? 1 : 0));
  return list;
}

async function freepikFetch(s: SeoBlogSettings, apiKey: string, path: string, init: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (const h of candidates(s)) {
    const r = await fetch(h.base + path, { ...init, headers: { ...(init.headers as any), [h.header]: apiKey } });
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      last = r;
      continue;
    }
    preferred = h;
    return r;
  }
  return last!;
}

/**
 * Comprueba la API key sin gastar créditos: pedimos el estado de una tarea inexistente.
 * Key válida → 404 (tarea no encontrada); key inválida → 401/403.
 */
export async function checkFreepikKey(workspaceId: string, s: SeoBlogSettings): Promise<{ ok: boolean; message: string }> {
  let apiKey = "";
  try {
    apiKey = await getFreepikKeyForWorkspace(workspaceId);
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "Sin API key de Freepik" };
  }
  for (const h of candidates(s)) {
    try {
      const r = await fetch(`${h.base}${s.freepikT2iPath}/00000000-0000-0000-0000-000000000000`, {
        headers: { [h.header]: apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000)
      });
      if (r.status === 404 || r.ok) {
        preferred = h;
        return { ok: true, message: `API key válida (${h.base.replace("https://", "")})` };
      }
      if (r.status === 401 || r.status === 403) continue;
      return { ok: false, message: `Respuesta inesperada de ${h.base} (${r.status})` };
    } catch (e: any) {
      return { ok: false, message: `No se pudo contactar con ${h.base}: ${e?.message ?? e}` };
    }
  }
  return { ok: false, message: "La API key de Freepik/Magnific no es válida o ha caducado. Genera una nueva en magnific.com → API y guárdala en el calendario editorial." };
}

export const NANO_BANANA_PATH = "/v1/ai/text-to-image/nano-banana-pro-flash"; // "Google Nano Banana 2" en Magnific (Gemini 3.1 Flash)

/** Seedream usa nombres (widescreen_16_9); Nano Banana usa proporciones (16:9). */
const ASPECT_TO_RATIO: Record<string, string> = {
  square_1_1: "1:1", widescreen_16_9: "16:9", social_story_9_16: "9:16", portrait_2_3: "2:3",
  traditional_3_4: "3:4", standard_3_2: "3:2", classic_4_3: "4:3", cinematic_21_9: "21:9"
};

function mimeFromUrl(u: string): string {
  const path = u.split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export function isNanoBanana(s: SeoBlogSettings): boolean {
  return (s.imageEngine || "nano-banana-2") !== "seedream-4.5";
}

export async function createSeedreamTask(
  workspaceId: string,
  s: SeoBlogSettings,
  prompt: string,
  aspect: string,
  refUrls: string[]
): Promise<{ taskId: string; endpoint: string }> {
  const apiKey = await getFreepikKeyForWorkspace(workspaceId);
  const nano = isNanoBanana(s);
  const refs = refUrls.filter(Boolean).slice(0, nano ? 8 : 5);
  const endpoint = nano ? NANO_BANANA_PATH : refs.length ? s.freepikEditPath : s.freepikT2iPath;
  const body: any = nano
    ? { prompt: prompt.slice(0, 12000), aspect_ratio: ASPECT_TO_RATIO[aspect] ?? (aspect.includes(":") ? aspect : "16:9"), resolution: s.imageResolution || "1K" }
    : { prompt: prompt.slice(0, 4000), aspect_ratio: aspect || "widescreen_16_9" };
  if (refs.length) body.reference_images = nano ? refs.map((u) => ({ image: u, mime_type: mimeFromUrl(u), text: "Visual style reference: palette, lighting, mood" })) : refs;
  const r = await freepikFetch(s, apiKey, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000)
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  const d = data?.data ?? data;
  if (r.status === 401 || r.status === 403) throw new Error("La API key de Freepik/Magnific no es válida o ha caducado. Genera una nueva en magnific.com → API y guárdala en el calendario editorial.");
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
  const r = await freepikFetch(s, apiKey, `${endpoint}/${encodeURIComponent(taskId)}`, {
    headers: { Accept: "application/json" },
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
