const STORE_DESCRIPTORS = new Set([
  "supermercado", "supermercados", "hipermercado", "hipermercados", "tienda", "tiendas",
  "store", "market", "express", "centro", "comercial", "sa", "sl", "slu", "s", "a"
]);

export function normalizeBrandName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token && !STORE_DESCRIPTORS.has(token))
    .join(" ")
    .trim();
}

/** Strict enough to avoid importing another chain merely because its address/name mentions the brand. */
export function isBrandLocation(locationName: string, requestedBrand: string): boolean {
  const name = normalizeBrandName(locationName);
  const brand = normalizeBrandName(requestedBrand);
  if (!name || !brand) return false;
  return name === brand || name.startsWith(`${brand} `) || name.startsWith(`mi ${brand}`);
}

export function dedupeBrandLocations<T extends { placeId: string }>(locations: T[]): T[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    if (!location.placeId || seen.has(location.placeId)) return false;
    seen.add(location.placeId);
    return true;
  });
}
