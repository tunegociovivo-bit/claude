/**
 * Extrae texto plano de un File adjunto para que Sonia pueda leerlo.
 *
 * Cobertura Fase 3:
 *   - PDF       → pdf-parse
 *   - DOCX      → mammoth
 *   - XLSX/XLS  → xlsx (cada hoja como CSV)
 *   - TXT/MD/CSV/JSON/HTML → utf-8 directo
 *   - IMAGE/*   → no soportado (mensaje sugiriendo describir en
 *                 add_comment o usar tool de visión cuando exista)
 *   - Resto     → error con sugerencia
 *
 * Tope: 10MB en el Buffer original, 200K chars en el texto extraído
 * (truncamos con marca explícita). Por encima la IA debería pedir
 * que se le pase un fragmento concreto.
 */

import { downloadBuffer } from "@/lib/storage/r2";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

export type ExtractResult =
  | { ok: true; text: string; truncated: boolean; bytes: number; pages?: number; sheets?: string[] }
  | { ok: false; error: string };

export async function extractTextFromFile(opts: {
  s3Key: string;
  mimeType: string;
  filename: string;
  sizeBytes: number;
}): Promise<ExtractResult> {
  if (opts.sizeBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `Archivo demasiado grande (${(opts.sizeBytes / 1024 / 1024).toFixed(1)}MB > 10MB). Pide que se te pase un fragmento concreto.`
    };
  }
  const mime = (opts.mimeType ?? "").toLowerCase();
  const lower = opts.filename.toLowerCase();

  // Routing por mimeType primero, fallback por extensión.
  try {
    if (mime === "application/pdf" || lower.endsWith(".pdf")) {
      return await extractPdf(opts.s3Key);
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lower.endsWith(".docx")
    ) {
      return await extractDocx(opts.s3Key);
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mime === "application/vnd.ms-excel" ||
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls")
    ) {
      return await extractXlsx(opts.s3Key);
    }
    // Texto plano: utf-8 directo.
    if (
      mime.startsWith("text/") ||
      mime === "application/json" ||
      mime === "application/xml" ||
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".csv") ||
      lower.endsWith(".json") ||
      lower.endsWith(".html") ||
      lower.endsWith(".xml") ||
      lower.endsWith(".log")
    ) {
      const buf = await downloadBuffer(opts.s3Key);
      return wrap(buf.toString("utf8"), buf.length);
    }
    if (mime.startsWith("image/")) {
      return {
        ok: false,
        error: `Es una imagen (${mime}). Usa la tool \`analyze_image_deep({ fileId })\` para extraer descripción, colores hex, textos visibles (OCR), mood, composición y sugerencias.`
      };
    }
    return {
      ok: false,
      error: `Tipo no soportado (${mime || lower}). Tipos soportados: PDF, DOCX, XLSX/XLS, TXT, MD, CSV, JSON, HTML.`
    };
  } catch (e: any) {
    return { ok: false, error: `Extracción falló: ${e?.message ?? e}` };
  }
}

async function extractPdf(s3Key: string): Promise<ExtractResult> {
  const buf = await downloadBuffer(s3Key);
  // pdf-parse v2: clase PDFParse con .getText(). Dynamic import para
  // que el bundler no intente cargar pdf.js worker en cold start.
  const mod: any = await import("pdf-parse");
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse ?? mod.default;
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  // v2 puede devolver string, {text, pages} o {text, numpages} según release.
  const text =
    typeof result === "string"
      ? result
      : result?.text ?? result?.pages?.map((p: any) => p.text ?? "").join("\n\n") ?? "";
  const pages = result?.numpages ?? result?.pages?.length ?? undefined;
  return wrap(text, buf.length, { pages });
}

async function extractDocx(s3Key: string): Promise<ExtractResult> {
  const buf = await downloadBuffer(s3Key);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: buf });
  return wrap(result.value ?? "", buf.length);
}

async function extractXlsx(s3Key: string): Promise<ExtractResult> {
  const buf = await downloadBuffer(s3Key);
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheets: string[] = wb.SheetNames;
  // Concatenamos cada hoja como CSV con header de nombre.
  const parts: string[] = [];
  for (const name of sheets) {
    const ws = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(ws);
    parts.push(`### Hoja: ${name}\n${csv}`);
  }
  return wrap(parts.join("\n\n"), buf.length, { sheets });
}

function wrap(
  text: string,
  bytes: number,
  extra?: { pages?: number; sheets?: string[] }
): ExtractResult {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_TEXT_CHARS) {
    return { ok: true, text: trimmed, truncated: false, bytes, ...extra };
  }
  return {
    ok: true,
    text: trimmed.slice(0, MAX_TEXT_CHARS) + `\n\n[…TRUNCADO en ${MAX_TEXT_CHARS} chars de ${trimmed.length} totales…]`,
    truncated: true,
    bytes,
    ...extra
  };
}
