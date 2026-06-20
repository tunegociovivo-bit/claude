/**
 * Geocoding para Bubui: dirección de texto → coordenadas + localidad/provincia
 * normalizadas (Google Geocoding API con la key de entorno). Se usa al dar de
 * alta un negocio para que aparezca en el mapa y en la página de su localidad
 * correcta del directorio. Degradación elegante: si no hay key o falla,
 * devuelve null y el alta sigue con la ciudad tecleada y sin coordenadas.
 */

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  city: string | null;
  province: string | null;
};

export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || !query.trim()) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("key", key);
    url.searchParams.set("language", "es");
    url.searchParams.set("region", "es");
    const r = await fetch(url.toString());
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const res = j?.results?.[0];
    if (!res?.geometry?.location) return null;

    const comps: any[] = res.address_components ?? [];
    const find = (type: string) => comps.find((c) => (c.types ?? []).includes(type))?.long_name ?? null;
    // Ciudad: locality; si no, postal_town o nivel administrativo 3.
    const city = find("locality") || find("postal_town") || find("administrative_area_level_3");
    // Provincia en España: administrative_area_level_2.
    const province = find("administrative_area_level_2") || find("administrative_area_level_1");

    return {
      latitude: res.geometry.location.lat,
      longitude: res.geometry.location.lng,
      city,
      province
    };
  } catch {
    return null;
  }
}
