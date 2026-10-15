// Detecta listas de coches dentro de respuestas JSON de los portales (todas
// sus webs son aplicaciones que piden los coches a una API interna). Sin saber
// el formato exacto de cada portal, busca arrays de objetos con «pinta» de
// coche y saca marca, modelo, km, precio, año… por sinónimos de campo.
import crypto from "crypto";
import {
  cleanText,
  normalizeCountry,
  normalizeFuel,
  normalizeGearbox,
  parseDate,
  parseInteger,
  parseYear,
  safeHttpUrl,
} from "./normalize";

export type ExtractedVehicle = {
  externalId: string;
  url: string | null;
  title: string;
  make: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  priceLabel: string | null;
  fuel: string | null;
  gearbox: string | null;
  powerCv: number | null;
  bodyType: string | null;
  color: string | null;
  country: string | null;
  location: string | null;
  auctionEndsAt: Date | null;
  imageUrl: string | null;
  raw: unknown;
};

// Sinónimos (minúsculas, sin separadores) de cada dato en distintos idiomas/APIs.
const KEYS = {
  id: ["id", "vehicleid", "carid", "stockid", "stocknumber", "stockno", "lotid", "lotnumber", "lotno", "auctionid", "offerid", "itemid", "uuid", "reference", "ref", "refid", "vin", "chassisnumber", "listingid", "advertid", "adid"],
  make: ["make", "brand", "manufacturer", "marke", "marque", "marca", "makename", "brandname", "manufacturername", "makedescription"],
  model: ["model", "modelname", "modele", "modelo", "modell", "modeldescription", "baseModel".toLowerCase(), "modelline", "modelgroup"],
  version: ["version", "variant", "trim", "derivative", "submodel", "modelversion", "equipmentline", "typename", "type", "versionname", "description"],
  title: ["title", "name", "headline", "vehiclename", "fullname", "displayname", "label", "vehicledescription", "designation", "libelle"],
  km: ["mileage", "km", "kms", "kilometers", "kilometres", "kilometraje", "kilometrage", "odometer", "odometerreading", "mileagekm", "mileageinkm", "kmstand", "laufleistung", "distance"],
  price: [
    "currentbid", "highestbid", "currentprice", "buynowprice", "buyitnowprice", "instantbuyprice", "fixedprice", "price", "startprice",
    "startingprice", "startingbid", "minimumbid", "minimumprice", "askingprice", "saleprice", "reserveprice", "netprice", "grossprice",
    "precio", "prix", "preis", "amount", "bid", "pricegross", "pricenet", "retailprice", "tradeprice", "offerprice", "estimatedprice",
  ],
  year: ["firstregistration", "firstregistrationdate", "registrationdate", "registrationyear", "firstregistrationyear", "year", "modelyear", "buildyear", "productionyear", "constructionyear", "matriculacion", "fechamatriculacion", "anio", "ano", "erstzulassung", "dateofregistration", "datemisecirculation", "misecirculation", "initialregistration", "manufacturingyear"],
  fuel: ["fuel", "fueltype", "fuelcategory", "energy", "energie", "combustible", "kraftstoff", "carburant", "engine", "enginetype", "motorization"],
  gearbox: ["gearbox", "transmission", "transmissiontype", "gearboxtype", "cambio", "getriebe", "boite", "boitedevitesse", "gear"],
  power: ["powerhp", "powerps", "powercv", "hp", "ps", "cv", "horsepower", "power", "enginepower", "potencia", "leistung", "puissance", "powerkw", "kw"],
  body: ["bodytype", "body", "bodystyle", "carrosserie", "carroceria", "category", "vehicletype", "segment"],
  color: ["color", "colour", "couleur", "farbe", "exteriorcolor", "exteriorcolour", "paint"],
  country: ["country", "countrycode", "pais", "pays", "land", "locationcountry", "vehiclecountry", "origincountry", "sellercountry"],
  location: ["location", "city", "town", "ciudad", "localidad", "branch", "site", "compound", "address", "pickuplocation", "storagelocation", "ville", "ort", "stocklocation"],
  ends: ["auctionend", "auctionenddate", "auctionendtime", "enddate", "endtime", "endsat", "enddatetime", "closingdate", "closingtime", "closesat", "expirationdate", "expiresat", "deadline", "biddingend", "saleend", "fechafin", "endofauction", "closedate", "end"],
  image: ["imageurl", "image", "mainimage", "thumbnail", "thumbnailurl", "photo", "photourl", "picture", "pictureurl", "mainphoto", "coverimage", "img", "images", "photos", "pictures", "media", "gallery", "imageurls"],
  url: ["url", "link", "href", "detailurl", "detailsurl", "vehicleurl", "permalink", "weburl", "deeplink", "detaillink"],
} as const;

type Field = keyof typeof KEYS;
const FIELD_OF = new Map<string, Field>();
for (const [field, keys] of Object.entries(KEYS) as Array<[Field, readonly string[]]>) {
  for (const k of keys) if (!FIELD_OF.has(k)) FIELD_OF.set(k, field);
}

const flat = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Campos «de coche» presentes en un objeto (mirando también un nivel por debajo). */
function vehicleFields(obj: Record<string, unknown>): Set<Field> {
  const found = new Set<Field>();
  const visit = (o: Record<string, unknown>, depth: number) => {
    for (const [k, v] of Object.entries(o)) {
      const f = FIELD_OF.get(flat(k));
      if (f && v !== null && v !== undefined && v !== "") found.add(f);
      if (depth < 1 && v && typeof v === "object" && !Array.isArray(v)) visit(v as Record<string, unknown>, depth + 1);
    }
  };
  visit(obj, 0);
  return found;
}

function looksLikeVehicle(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const f = vehicleFields(obj as Record<string, unknown>);
  const identity = f.has("make") || f.has("model") || f.has("title");
  const specs = (f.has("km") ? 1 : 0) + (f.has("price") ? 1 : 0) + (f.has("year") ? 1 : 0) + (f.has("fuel") ? 1 : 0) + (f.has("gearbox") ? 1 : 0);
  return identity && specs >= 2;
}

/** Busca (en profundidad) todos los arrays cuyo contenido parece una lista de coches. */
export function findVehicleArrays(json: unknown, maxDepth = 7): unknown[][] {
  const out: unknown[][] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > maxDepth || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const objects = node.filter((x) => x && typeof x === "object" && !Array.isArray(x));
      if (objects.length >= 1) {
        const sample = objects.slice(0, 20);
        const hits = sample.filter(looksLikeVehicle).length;
        if (hits >= Math.max(1, Math.ceil(sample.length * 0.6))) {
          out.push(objects);
          return;
        }
      }
      for (const item of node.slice(0, 500)) walk(item, depth + 1);
      return;
    }
    for (const v of Object.values(node as Record<string, unknown>)) walk(v, depth + 1);
  };
  walk(json, 0);
  return out;
}

// Valor del primer campo (por orden de sinónimos) presente en el objeto o en
// un objeto hijo directo (p. ej. vehicle.make.name, price.amount).
function pick(obj: Record<string, unknown>, field: Field): unknown {
  const keys = KEYS[field];
  const index = new Map<string, unknown>();
  const children: Record<string, unknown>[] = [];
  for (const [k, v] of Object.entries(obj)) {
    index.set(flat(k), v);
    if (v && typeof v === "object" && !Array.isArray(v)) children.push(v as Record<string, unknown>);
  }
  for (const k of keys) {
    const v = index.get(k);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  for (const child of children) {
    const ci = new Map(Object.entries(child).map(([k, v]) => [flat(k), v] as const));
    for (const k of keys) {
      const v = ci.get(k);
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}

function pickPrice(obj: Record<string, unknown>): { price: number | null; label: string | null } {
  const LABELS: Array<[string[], string]> = [
    [["buynowprice", "buyitnowprice", "instantbuyprice", "fixedprice"], "Compra ya"],
    [["currentbid", "highestbid", "currentprice"], "Puja actual"],
    [["startprice", "startingprice", "startingbid", "minimumbid", "minimumprice"], "Precio de salida"],
  ];
  const index = new Map<string, unknown>();
  const walkIdx = (o: Record<string, unknown>, depth: number) => {
    for (const [k, v] of Object.entries(o)) {
      if (!index.has(flat(k))) index.set(flat(k), v);
      if (depth < 1 && v && typeof v === "object" && !Array.isArray(v)) walkIdx(v as Record<string, unknown>, depth + 1);
    }
  };
  walkIdx(obj, 0);
  for (const [keys, label] of LABELS) {
    for (const k of keys) {
      const n = parseInteger(index.get(k));
      if (n !== null && n > 0) return { price: n, label };
    }
  }
  const n = parseInteger(pick(obj, "price"));
  return { price: n !== null && n > 0 ? n : null, label: n !== null && n > 0 ? "Precio" : null };
}

function pickImage(v: unknown, base?: string): string | null {
  if (!v) return null;
  if (typeof v === "string") return safeHttpUrl(v, base);
  if (Array.isArray(v)) {
    for (const item of v.slice(0, 3)) {
      const u = pickImage(item, base);
      if (u) return u;
    }
    return null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["url", "src", "href", "large", "medium", "small", "thumbnail", "original", "uri", "path"]) {
      const u = pickImage(o[k], base);
      if (u) return u;
    }
  }
  return null;
}

function powerToCv(obj: Record<string, unknown>): number | null {
  const index = new Map(Object.entries(obj).map(([k, v]) => [flat(k), v] as const));
  for (const k of ["powerhp", "powerps", "powercv", "hp", "ps", "cv", "horsepower"]) {
    const n = parseInteger(index.get(k));
    if (n && n > 20 && n < 2000) return n;
  }
  for (const k of ["powerkw", "kw"]) {
    const n = parseInteger(index.get(k));
    if (n && n > 15 && n < 1500) return Math.round(n * 1.35962);
  }
  const p = pick(obj, "power");
  if (typeof p === "string") {
    const kw = p.match(/(\d{2,4})\s*kw/i);
    const cv = p.match(/(\d{2,4})\s*(cv|ps|hp)/i);
    if (cv) return Number(cv[1]);
    if (kw) return Math.round(Number(kw[1]) * 1.35962);
  }
  const n = parseInteger(p);
  return n && n > 20 && n < 2000 ? n : null;
}

/** Recorta el JSON original para guardarlo (depuración) sin ocupar mucho. */
export function trimRaw(value: unknown, maxChars = 6000): unknown {
  try {
    const s = JSON.stringify(value);
    if (s.length <= maxChars) return value;
    const o = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    if (!o) return { truncated: s.slice(0, maxChars) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === null || typeof v !== "object") out[k] = typeof v === "string" ? v.slice(0, 300) : v;
    }
    return out;
  } catch {
    return null;
  }
}

export function hashId(...parts: unknown[]): string {
  return "h" + crypto.createHash("sha1").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 20);
}

export type VehicleMapOptions = {
  baseUrl?: string;
  /** Construye el enlace al coche en el portal a partir del objeto original. */
  urlFor?: (raw: Record<string, unknown>, id: string) => string | null;
  defaultCountry?: string | null;
};

/** Convierte un objeto «con pinta de coche» al formato común. */
export function mapVehicle(raw: Record<string, unknown>, opts: VehicleMapOptions = {}): ExtractedVehicle | null {
  const make = cleanText(pick(raw, "make"), 60);
  const model = cleanText(pick(raw, "model"), 80);
  let version = cleanText(pick(raw, "version"), 160);
  let title = cleanText(pick(raw, "title"), 200);
  if (!title) title = [make, model, version].filter(Boolean).join(" ") || null;
  if (!title) return null;
  if (version && title && version === title) version = null;
  const km = parseInteger(pick(raw, "km"));
  const { price, label } = pickPrice(raw);
  const year = parseYear(pick(raw, "year"));
  const idValue = cleanText(pick(raw, "id"), 120);
  const externalId = idValue ? idValue.replace(/\s+/g, "") : hashId(title, km, year, price);
  const urlRaw = pick(raw, "url");
  const url = (opts.urlFor?.(raw, externalId) ?? null) || (typeof urlRaw === "string" ? safeHttpUrl(urlRaw, opts.baseUrl) : null);
  const endsRaw = pick(raw, "ends");
  return {
    externalId,
    url,
    title,
    make,
    model,
    version,
    year,
    km: km !== null && km >= 0 && km < 2_000_000 ? km : null,
    price: price !== null && price < 10_000_000 ? price : null,
    priceLabel: label,
    fuel: normalizeFuel(cleanText(pick(raw, "fuel"))),
    gearbox: normalizeGearbox(cleanText(pick(raw, "gearbox"))),
    powerCv: powerToCv(raw),
    bodyType: cleanText(pick(raw, "body"), 60),
    color: cleanText(pick(raw, "color"), 40),
    country: normalizeCountry(cleanText(pick(raw, "country"))) ?? normalizeCountry(cleanText(pick(raw, "location"))) ?? opts.defaultCountry ?? null,
    location: cleanText(pick(raw, "location"), 120),
    auctionEndsAt: parseDate(typeof endsRaw === "object" && endsRaw ? cleanText(endsRaw) : endsRaw),
    imageUrl: pickImage(pick(raw, "image"), opts.baseUrl),
    raw: trimRaw(raw),
  };
}

/** Todos los coches que hay en una respuesta JSON (sin duplicados por id). */
export function extractVehiclesFromJson(json: unknown, opts: VehicleMapOptions = {}): ExtractedVehicle[] {
  const out = new Map<string, ExtractedVehicle>();
  for (const arr of findVehicleArrays(json)) {
    for (const item of arr) {
      const v = mapVehicle(item as Record<string, unknown>, opts);
      if (v && !out.has(v.externalId)) out.set(v.externalId, v);
    }
  }
  return [...out.values()];
}
