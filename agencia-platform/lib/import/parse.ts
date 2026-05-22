/**
 * Lee un archivo subido (Buffer) y lo convierte en filas estructuradas.
 *   - CSV / XLSX / XLS → tabla (cabeceras + filas) vía SheetJS.
 *   - PDF → texto plano (pdf-parse); la extracción a filas la hace la IA
 *     en el módulo de cada entidad.
 */

export type Tabular = { headers: string[]; rows: string[][] };

export type ParsedFile =
  | { kind: "tabular"; format: "csv" | "xlsx"; data: Tabular }
  | { kind: "pdf"; format: "pdf"; text: string };

export function detectFormat(filename: string, mime: string): "csv" | "xlsx" | "pdf" | null {
  const lower = (filename || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    m === "application/vnd.ms-excel" ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls")
  )
    return "xlsx";
  if (m === "text/csv" || m === "application/csv" || lower.endsWith(".csv") || m.startsWith("text/"))
    return "csv";
  return null;
}

export async function parseFile(buf: Buffer, filename: string, mime: string): Promise<ParsedFile> {
  const format = detectFormat(filename, mime);
  if (!format) {
    throw new Error("Formato no soportado. Usa PDF, CSV o Excel (.xlsx/.xls).");
  }
  if (format === "pdf") {
    return { kind: "pdf", format: "pdf", text: await extractPdfText(buf) };
  }
  return { kind: "tabular", format, data: await parseTabular(buf) };
}

async function parseTabular(buf: Buffer): Promise<Tabular> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer", raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as any[][];
  if (matrix.length === 0) return { headers: [], rows: [] };

  // Primera fila no vacía = cabeceras.
  let headerIdx = matrix.findIndex((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (headerIdx < 0) headerIdx = 0;
  const headers = (matrix[headerIdx] ?? []).map((c) => String(c ?? "").trim());
  const rows = matrix
    .slice(headerIdx + 1)
    .map((r) => headers.map((_, i) => String(r[i] ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));
  return { headers, rows };
}

async function extractPdfText(buf: Buffer): Promise<string> {
  const mod: any = await import("pdf-parse");
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse ?? mod.default;
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  const text =
    typeof result === "string"
      ? result
      : result?.text ?? result?.pages?.map((p: any) => p.text ?? "").join("\n\n") ?? "";
  return String(text).trim();
}

/** Renderiza una tabla como texto (cabeceras + filas) para pasársela a la IA. */
export function tabularToText(t: Tabular): string {
  const esc = (c: string) => (c.includes(",") || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c);
  const head = t.headers.map(esc).join(",");
  const body = t.rows
    .slice(0, 2000)
    .map((r) => r.map((c) => esc(c ?? "")).join(","))
    .join("\n");
  return [head, body].filter(Boolean).join("\n");
}

/** Convierte una tabla en objetos { header: value }. */
export function tabularToObjects(t: Tabular): Record<string, string>[] {
  return t.rows.map((row) => {
    const o: Record<string, string> = {};
    t.headers.forEach((h, i) => {
      o[h] = row[i] ?? "";
    });
    return o;
  });
}
