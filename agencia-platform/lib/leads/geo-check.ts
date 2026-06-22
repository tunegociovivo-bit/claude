/**
 * Detección de incoherencia geográfica de un lead: sus coordenadas vs su
 * provincia. El ranking por cercanía usa lat/lng; si esas coordenadas están en
 * otra provincia (p. ej. un negocio "de Sevilla" con coords en Tenerife por un
 * scrape con geo errónea), el ranking sale mal. Esto lo avisa.
 *
 * Reverse-geocoding con la key de entorno. Caché en memoria por coordenadas
 * (redondeadas) para no repetir la llamada.
 */

const KEY = () => process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;

const cache = new Map<string, { at: number; province: string | null; city: string | null }>();
const TTL = 24 * 60 * 60 * 1000;

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Provincia/ciudad reales según las coordenadas (o null si no se puede). */
export async function reverseProvince(lat: number, lng: number): Promise<{ province: string | null; city: string | null } | null> {
  const key = KEY();
  if (!key || lat == null || lng == null) return null;
  const ck = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return { province: hit.province, city: hit.city };
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", key);
    url.searchParams.set("language", "es");
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const comps: any[] = j?.results?.[0]?.address_components ?? [];
    const find = (t: string) => comps.find((c) => (c.types ?? []).includes(t))?.long_name ?? null;
    const province = find("administrative_area_level_2") || find("administrative_area_level_1");
    const city = find("locality") || find("postal_town") || find("administrative_area_level_3");
    cache.set(ck, { at: Date.now(), province, city });
    return { province, city };
  } catch {
    return null;
  }
}

/** ¿La provincia detectada por coords contradice la del lead? */
export function provinceMismatch(leadProvince: string | null | undefined, detected: string | null | undefined): boolean {
  const a = norm(leadProvince);
  const b = norm(detected);
  if (!a || !b) return false;
  // Coinciden si una contiene a la otra (p. ej. "tenerife" ⊂ "santa cruz de tenerife").
  return !(a.includes(b) || b.includes(a));
}
