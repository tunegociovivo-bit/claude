/**
 * Genera el CSV con publicaciones del calendario editorial en el formato
 * que el importador masivo de Metricool acepta de verdad.
 *
 * Estructura (cabeceras EXACTAS de la plantilla de Metricool):
 *   Text, Date, Time, Draft,
 *   Facebook, Twitter/X, LinkedIn, GBP, Instagram, Pinterest, TikTok,
 *   YouTube, Threads, Bluesky,            ← TRUE/FALSE por red
 *   Instagram Post Type, Facebook Post Type,  ← POST/REEL/STORY
 *   Picture Url 1 … Picture Url 10        ← una URL pública por columna
 *
 * UNA fila por publicación (no por red): las redes se marcan con TRUE/FALSE
 * en sus columnas. Fecha en YYYY-MM-DD y hora en HH:MM:SS (hay que elegir
 * ese mismo formato al importar en Metricool).
 *
 * Antes exportábamos cabeceras en español y una sola columna "Red social"
 * con el nombre de la red por fila — Metricool lo rechazaba.
 */

const PICTURE_COLS = 10;

const NETWORK_COLUMNS = [
  "Facebook",
  "Twitter/X",
  "LinkedIn",
  "GBP",
  "Instagram",
  "Pinterest",
  "TikTok",
  "YouTube",
  "Threads",
  "Bluesky"
] as const;
type NetworkColumn = (typeof NETWORK_COLUMNS)[number];

function buildHeaders(): string[] {
  const pics = Array.from({ length: PICTURE_COLS }, (_, i) => `Picture Url ${i + 1}`);
  return [
    "Text",
    "Date",
    "Time",
    "Draft",
    ...NETWORK_COLUMNS,
    "Instagram Post Type",
    "Facebook Post Type",
    ...pics
  ];
}

function mapNetwork(raw: string): NetworkColumn | null {
  const n = String(raw).toLowerCase().trim();
  if (/insta/.test(n)) return "Instagram";
  if (/face|\bfb\b/.test(n)) return "Facebook";
  if (/twitter|tweet|^x$/.test(n)) return "Twitter/X";
  if (/linkedin/.test(n)) return "LinkedIn";
  if (/google|gbp|gmb|business|mi negocio|my business/.test(n)) return "GBP";
  if (/pinterest/.test(n)) return "Pinterest";
  if (/tik\s?tok/.test(n)) return "TikTok";
  if (/youtube|^yt$/.test(n)) return "YouTube";
  if (/threads/.test(n)) return "Threads";
  if (/bluesky|bsky/.test(n)) return "Bluesky";
  return null;
}

/** Mapea nuestro `format` a los valores de tipo de Metricool. */
function mapPostType(format: string | null | undefined): "POST" | "REEL" | "STORY" {
  const f = String(format ?? "").toLowerCase();
  if (/reel|video|vídeo/.test(f)) return "REEL";
  if (/stor/.test(f)) return "STORY";
  return "POST"; // post, carrusel, imagen, etc.
}

function csvEscape(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

type Post = {
  id: string;
  title: string;
  content: string | null;
  excerpt: string | null;
  scheduledFor: Date | null;
  format: string | null;
  networks: string; // JSON array
  thumbnail: string | null;
  mediaUrls: string; // JSON array
  client?: { name: string } | null;
};

export function buildMetricoolCsv(posts: Post[]): { csv: string; rowCount: number; postIds: string[] } {
  const headers = buildHeaders();
  const rows: string[] = [headers.join(",")];
  const includedIds = new Set<string>();

  for (const p of posts) {
    if (!p.scheduledFor) continue;
    const date = p.scheduledFor;
    const fecha = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    const hora = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")}`;

    // Redes activas de la publicación.
    let rawNetworks: string[] = [];
    try {
      const parsed = JSON.parse(p.networks);
      if (Array.isArray(parsed)) rawNetworks = parsed.map(String);
    } catch {}
    const active = new Set<NetworkColumn>();
    for (const r of rawNetworks) {
      const col = mapNetwork(r);
      if (col) active.add(col);
    }
    if (active.size === 0) active.add("Instagram"); // fallback razonable

    // Imágenes / vídeos → Picture Url 1..N.
    let mediaUrls: string[] = [];
    try {
      const parsed = JSON.parse(p.mediaUrls);
      if (Array.isArray(parsed)) mediaUrls = parsed.map(String).filter(Boolean);
    } catch {}
    if (mediaUrls.length === 0 && p.thumbnail) mediaUrls = [p.thumbnail];
    const pics = mediaUrls.slice(0, PICTURE_COLS);

    const texto = (p.content?.trim() || p.excerpt?.trim() || p.title || "").slice(0, 2000);
    const postType = mapPostType(p.format);

    const record: Record<string, string> = {
      Text: texto,
      Date: fecha,
      Time: hora,
      Draft: "FALSE",
      "Instagram Post Type": active.has("Instagram") ? postType : "",
      "Facebook Post Type": active.has("Facebook") ? postType : ""
    };
    for (const col of NETWORK_COLUMNS) record[col] = active.has(col) ? "TRUE" : "FALSE";
    for (let i = 0; i < PICTURE_COLS; i++) record[`Picture Url ${i + 1}`] = pics[i] ?? "";

    rows.push(headers.map((h) => csvEscape(record[h] ?? "")).join(","));
    includedIds.add(p.id);
  }

  return {
    csv: rows.join("\r\n"),
    rowCount: rows.length - 1,
    postIds: Array.from(includedIds)
  };
}
