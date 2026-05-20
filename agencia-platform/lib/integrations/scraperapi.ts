/**
 * ScraperAPI — detección de fichas de Google "reclamables" (sin dueño), para
 * el Buscador GMB. Renderiza la página de Google Maps del negocio y busca los
 * textos de "Reclamar esta empresa". Key en settings.integrations.gmb.scraperApiKeyEnc.
 */
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

export class ScraperKeyMissingError extends Error {
  constructor() {
    super("Falta la API key de ScraperAPI. Configúrala en GMB Hub → Ajustes.");
  }
}

export async function getScraperKey(workspaceId: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  if (g.scraperApiKeyEnc) {
    const k = decryptSecret(g.scraperApiKeyEnc);
    if (k) return k;
  }
  return process.env.SCRAPERAPI_KEY ?? null;
}

const CLAIM_STRINGS = [
  "Reclamar esta empresa",
  "Reclama esta empresa",
  "Claim this business",
  "Own this business",
  "¿Es tu empresa?",
  "¿Eres el propietario"
];

/**
 * Comprueba si una ficha de Google es reclamable. `mapsUrl` = URL de Google
 * Maps del lugar (se construye con el place_id). Devuelve true/false, o null
 * si no se pudo determinar.
 */
export async function checkClaimable(opts: {
  workspaceId: string;
  placeId: string;
  name?: string;
}): Promise<boolean | null> {
  const key = await getScraperKey(opts.workspaceId);
  if (!key) throw new ScraperKeyMissingError();
  const target = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.name ?? "")}&query_place_id=${encodeURIComponent(opts.placeId)}`;
  const url = `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(target)}&render=true&country_code=es`;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(90000) });
    if (!r.ok) return null;
    const html = await r.text();
    return CLAIM_STRINGS.some((s) => html.includes(s));
  } catch {
    return null;
  }
}
