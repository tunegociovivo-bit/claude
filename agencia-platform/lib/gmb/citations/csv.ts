/**
 * Importación/exportación CSV de citaciones — PURO (sin red). Importar NUNCA inventa presencia:
 * solo registra lo que el CSV declara (con validación). Exportar vuelca el inventario actual.
 */
import { CITATION_STATUSES, type CitationStatus } from "./engine";

export type CitationCsvRow = { directory: string; url: string; status: CitationStatus; name?: string; address?: string; phone?: string; website?: string };
export type CsvParseResult = { rows: CitationCsvRow[]; errors: string[] };

const HEADERS = ["directory", "url", "status", "name", "address", "phone", "website"];

/** Divide una línea CSV respetando comillas dobles. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCitationsCsv(text: string): CsvParseResult {
  const errors: string[] = [];
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], errors: ["CSV vacío"] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  if (idx("directory") < 0) return { rows: [], errors: ["Falta la columna obligatoria 'directory'"] };
  const rows: CitationCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const directory = (cols[idx("directory")] ?? "").trim();
    if (!directory) { errors.push(`Fila ${i + 1}: directory vacío`); continue; }
    let status = (idx("status") >= 0 ? cols[idx("status")] : "").trim() as CitationStatus;
    if (!CITATION_STATUSES.includes(status)) status = "not_found";
    rows.push({
      directory,
      url: (idx("url") >= 0 ? cols[idx("url")] : "").trim(),
      status,
      name: idx("name") >= 0 ? cols[idx("name")]?.trim() : undefined,
      address: idx("address") >= 0 ? cols[idx("address")]?.trim() : undefined,
      phone: idx("phone") >= 0 ? cols[idx("phone")]?.trim() : undefined,
      website: idx("website") >= 0 ? cols[idx("website")]?.trim() : undefined
    });
  }
  return { rows, errors };
}

function esc(v: any): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCitationsCsv(citations: { directorySlug: string; directoryName?: string; url?: string; status?: string; napObserved?: any }[]): string {
  const lines = [HEADERS.join(",")];
  for (const c of citations) {
    const nap = c.napObserved ?? {};
    lines.push([c.directorySlug || c.directoryName || "", c.url ?? "", c.status ?? "", nap.name ?? "", nap.address ?? "", nap.phone ?? "", nap.website ?? ""].map(esc).join(","));
  }
  return lines.join("\n");
}
