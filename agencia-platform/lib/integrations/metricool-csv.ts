/**
 * Genera el CSV con publicaciones del calendario editorial en el formato
 * que el importador masivo de Metricool acepta.
 *
 * Formato (una fila por (publicación, red social)):
 *   Fecha, Hora, Red, Texto, Imagen URL, Marca/Cliente, Formato
 *
 * Separador: coma. Textos con coma/comillas/saltos se entrecomillan
 * con comillas dobles escapando las internas como "".
 */

type ExportRow = {
  fecha: string;       // YYYY-MM-DD
  hora: string;        // HH:MM
  red: string;
  texto: string;
  imagen: string;
  cliente: string;
  formato: string;
};

const HEADERS: (keyof ExportRow)[] = [
  "fecha",
  "hora",
  "red",
  "texto",
  "imagen",
  "cliente",
  "formato"
];

const HEADER_LABELS: Record<keyof ExportRow, string> = {
  fecha: "Fecha",
  hora: "Hora",
  red: "Red social",
  texto: "Texto",
  imagen: "Imagen URL",
  cliente: "Cliente",
  formato: "Formato"
};

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
  const rows: string[] = [HEADERS.map((h) => HEADER_LABELS[h]).join(",")];
  const includedIds = new Set<string>();

  for (const p of posts) {
    if (!p.scheduledFor) continue;
    const date = p.scheduledFor;
    const fecha = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    const hora = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;

    let networks: string[] = [];
    try {
      const parsed = JSON.parse(p.networks);
      if (Array.isArray(parsed)) networks = parsed.map(String);
    } catch {}
    if (networks.length === 0) networks = ["instagram"]; // fallback

    let mediaUrls: string[] = [];
    try {
      const parsed = JSON.parse(p.mediaUrls);
      if (Array.isArray(parsed)) mediaUrls = parsed.map(String);
    } catch {}
    const imagen = (p.thumbnail || mediaUrls[0] || "").toString();

    // Texto: usar excerpt si content vacío, fallback a title
    const texto = (p.content?.trim() || p.excerpt?.trim() || p.title).slice(0, 2000);

    // Una fila por red
    for (const red of networks) {
      const row: ExportRow = {
        fecha,
        hora,
        red: capitalize(red),
        texto,
        imagen,
        cliente: p.client?.name ?? "",
        formato: p.format ?? "post"
      };
      rows.push(HEADERS.map((h) => csvEscape(row[h])).join(","));
    }
    includedIds.add(p.id);
  }

  return {
    csv: rows.join("\r\n"),
    rowCount: rows.length - 1,
    postIds: Array.from(includedIds)
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
