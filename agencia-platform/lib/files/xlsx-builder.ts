/**
 * Constructor de XLSX "presentable" para cliente — estilos profesionales,
 * cabeceras coloreadas, zebra striping, freeze pane, auto-width, hoja
 * Resumen con título grande.
 *
 * Por qué exceljs y no xlsx:
 *   - xlsx community NO soporta estilos (background, font, bordes).
 *     Genera spreadsheets totalmente planos, suficientes para
 *     analistas internos pero NO para entregar a cliente.
 *   - exceljs soporta el modelo completo de OOXML: estilos, merges,
 *     freeze, charts (no usamos charts aquí, pero está disponible).
 *
 * La filosofía: ningún caller debería tener que pasar 50 props de
 * estilo. Aplicamos un TEMA por defecto razonable (azul corporativo)
 * y el caller solo decide:
 *   - título de cada hoja
 *   - filas (objects con keys = nombres de columna)
 *   - opcionalmente: orden de columnas, labels pretty, anchura custom
 */

import ExcelJS from "exceljs";

export type SheetSpec = {
  /** Nombre de la hoja (≤ 31 chars, sin /:*?[]). */
  name: string;
  /** Filas. Cada una un objeto plano. Las KEYs son nombres internos
   *  de columna; los labels visibles vienen de `columnLabels` o se
   *  pretty-formatean si no se da label. */
  rows: Array<Record<string, unknown>>;
  /** Orden explícito de columnas. Si no, se infiere de la primera fila. */
  columnOrder?: string[];
  /** Labels visibles por nombre de columna. snake_case → "Nombre Visible". */
  columnLabels?: Record<string, string>;
  /** Anchura por columna en chars. Default: auto. */
  columnWidths?: Record<string, number>;
  /** Texto opcional encima de la tabla — título de la hoja. */
  title?: string;
  /** Subtítulo (línea pequeña debajo del título). */
  subtitle?: string;
};

export type WorkbookSpec = {
  /** Tema visual del libro. Default "corporate". */
  theme?: "corporate" | "minimal" | "dark";
  /** Color principal del tema (header bg, título). Override del theme. */
  primaryColor?: string;
  /** Hojas. Se renderizan en orden. */
  sheets: SheetSpec[];
  /** Propiedades del archivo (visible en File > Properties). */
  meta?: {
    title?: string;
    subject?: string;
    creator?: string;
    company?: string;
  };
};

type ThemeColors = {
  headerBg: string;
  headerFg: string;
  zebra: string;
  title: string;
  border: string;
};

const THEMES: Record<string, ThemeColors> = {
  corporate: {
    headerBg: "FF1F4E79", // azul oscuro
    headerFg: "FFFFFFFF",
    zebra: "FFF2F7FC",
    title: "FF1F4E79",
    border: "FFCBD5E1"
  },
  minimal: {
    headerBg: "FFF1F5F9", // gris muy claro
    headerFg: "FF0F172A",
    zebra: "FFFAFAFA",
    title: "FF0F172A",
    border: "FFE2E8F0"
  },
  dark: {
    headerBg: "FF0F172A",
    headerFg: "FFFFFFFF",
    zebra: "FF1E293B",
    title: "FFFFFFFF",
    border: "FF334155"
  }
};

/**
 * Convierte snake_case / camelCase / kebab-case a "Title Case".
 * lead_id → "Lead ID"
 * createdTime → "Created Time"
 * full_name → "Full Name"
 *
 * Acrónimos conocidos quedan en mayúscula (ID, URL, IP, GMB, IA, SEO).
 */
function prettifyHeader(raw: string): string {
  const ACRONYMS = new Set(["id", "url", "ip", "gmb", "ia", "seo", "csv", "json", "html", "pdf", "ttl", "cpc", "ctr", "cpm", "cpl", "roas"]);
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w[0].toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(" ");
}

/**
 * Estima anchura adecuada para una columna basada en el contenido
 * (max entre header + valores), con un cap razonable.
 */
function inferColumnWidth(label: string, values: unknown[]): number {
  let max = label.length;
  for (const v of values) {
    if (v == null) continue;
    const s = String(v);
    if (s.length > max) max = s.length;
  }
  return Math.min(60, Math.max(8, max + 2));
}

/**
 * Resuelve la lista ordenada de keys de columna para una hoja. Si
 * `columnOrder` viene, lo respeta; si no, usa el orden de keys de
 * la primera fila + cualquier key extra que aparezca en filas
 * siguientes (al final).
 */
function resolveColumns(rows: Array<Record<string, unknown>>, columnOrder?: string[]): string[] {
  if (columnOrder && columnOrder.length > 0) {
    const set = new Set(columnOrder);
    // Añade columnas que aparezcan en rows pero no estén en order.
    for (const r of rows) {
      for (const k of Object.keys(r)) if (!set.has(k)) { columnOrder.push(k); set.add(k); }
    }
    return columnOrder;
  }
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!set.has(k)) { seen.push(k); set.add(k); }
    }
  }
  return seen;
}

/**
 * Construye y devuelve el Buffer XLSX con estilos.
 *
 * Si una hoja tiene `title`, se añade una fila grande con el título
 * en la fila 1 (merged across all columns), opcionalmente un
 * subtitle en la fila 2, y la cabecera de datos en la fila 3.
 * Si no hay título, la cabecera va directamente en fila 1.
 */
export async function buildStyledXlsx(spec: WorkbookSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.meta?.creator ?? "Sonia (Hub)";
  wb.created = new Date();
  wb.modified = new Date();
  if (spec.meta?.title) wb.title = spec.meta.title;
  if (spec.meta?.subject) wb.subject = spec.meta.subject;
  if (spec.meta?.company) wb.company = spec.meta.company;

  const theme = THEMES[spec.theme ?? "corporate"] ?? THEMES.corporate;
  if (spec.primaryColor) {
    // Permite override del color principal manteniendo el resto del tema.
    const hex = normalizeHex(spec.primaryColor);
    if (hex) {
      theme.headerBg = hex;
      theme.title = hex;
    }
  }

  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sanitizeSheetName(sheet.name), {
      views: [{ state: "frozen", ySplit: 0, xSplit: 0 }]
    });

    const columns = resolveColumns(sheet.rows, sheet.columnOrder);
    const labelFor = (k: string): string =>
      sheet.columnLabels?.[k] ?? prettifyHeader(k);

    let dataStartRow = 1;
    // Título opcional + subtítulo
    if (sheet.title) {
      const titleRow = ws.addRow([sheet.title]);
      titleRow.font = { name: "Calibri", size: 16, bold: true, color: { argb: theme.title } };
      titleRow.height = 26;
      ws.mergeCells(1, 1, 1, Math.max(1, columns.length));
      dataStartRow++;
      if (sheet.subtitle) {
        const subRow = ws.addRow([sheet.subtitle]);
        subRow.font = { name: "Calibri", size: 11, color: { argb: "FF64748B" }, italic: true };
        ws.mergeCells(dataStartRow, 1, dataStartRow, Math.max(1, columns.length));
        dataStartRow++;
      }
      // Fila vacía para espaciar
      ws.addRow([]);
      dataStartRow++;
    }

    // Cabecera de datos
    const headerLabels = columns.map(labelFor);
    const headerRow = ws.addRow(headerLabels);
    headerRow.font = { name: "Calibri", size: 11, bold: true, color: { argb: theme.headerFg } };
    headerRow.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
    headerRow.height = 22;
    headerRow.eachCell((cell: ExcelJS.Cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.headerBg } };
      cell.border = {
        top: { style: "thin", color: { argb: theme.border } },
        left: { style: "thin", color: { argb: theme.border } },
        bottom: { style: "thin", color: { argb: theme.border } },
        right: { style: "thin", color: { argb: theme.border } }
      };
    });

    // Filas de datos + zebra striping
    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const values = columns.map((k) => stringifyCell(row[k]));
      const r = ws.addRow(values);
      r.alignment = { vertical: "top", horizontal: "left", wrapText: false };
      if (i % 2 === 0) {
        r.eachCell((cell: ExcelJS.Cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.zebra } };
        });
      }
    }

    // Anchuras: si el caller las dio, las usamos; si no, inferimos.
    columns.forEach((k, idx) => {
      const explicit = sheet.columnWidths?.[k];
      if (typeof explicit === "number") {
        ws.getColumn(idx + 1).width = explicit;
      } else {
        const label = labelFor(k);
        const values = sheet.rows.map((r) => r[k]);
        ws.getColumn(idx + 1).width = inferColumnWidth(label, values);
      }
    });

    // Freeze: si hay título, freeze sobre la fila de header (dataStartRow);
    // si no, freeze sobre fila 1.
    ws.views = [{ state: "frozen", ySplit: dataStartRow, xSplit: 0 }];

    // Auto-filter sobre la cabecera de datos.
    if (sheet.rows.length > 0) {
      const lastCol = columnLetter(columns.length);
      ws.autoFilter = `A${dataStartRow}:${lastCol}${dataStartRow}`;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

function stringifyCell(v: unknown): unknown {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[/\\?*\[\]]/g, "_").slice(0, 31) || "Hoja";
}

function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, "").toUpperCase();
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (!/^[0-9A-F]{6}$/.test(s)) return null;
  return "FF" + s; // ARGB con alpha=FF
}

function columnLetter(n: number): string {
  // 1 → A, 26 → Z, 27 → AA, etc.
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
