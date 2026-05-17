/**
 * Lee un archivo de Google Drive (de la carpeta del workspace) y
 * devuelve texto plano. Maneja tanto archivos nativos (PDF, DOCX,
 * XLSX, TXT, etc — pasados al file-reader normal) como archivos
 * nativos de Google Workspace (Docs, Sheets, Slides — exportados al
 * mimeType correcto antes de extraer).
 *
 * Fase 4 NV IA. La seguridad (sandbox a la carpeta del workspace)
 * se aplica en lib/integrations/google-drive.ts — aquí confiamos en
 * que el caller pasó un fileId que ya está validado.
 */

import { downloadDriveFile, exportDriveFile } from "@/lib/integrations/google-drive";

const MAX_TEXT_CHARS = 200_000;

// MimeType de Google Workspace → mimeType de export que sí podemos
// pasar al extractor estándar. Para Sheets exportamos CSV directo
// (multi-hoja se pierde — para multi-hoja exportar a xlsx y pasar
// por file-reader).
const GOOGLE_NATIVE_EXPORTS: Record<string, { exportMime: string; resultMime: string }> = {
  "application/vnd.google-apps.document": {
    exportMime: "text/plain",
    resultMime: "text/plain"
  },
  "application/vnd.google-apps.spreadsheet": {
    exportMime: "text/csv",
    resultMime: "text/csv"
  },
  "application/vnd.google-apps.presentation": {
    exportMime: "text/plain",
    resultMime: "text/plain"
  },
  "application/vnd.google-apps.script": {
    exportMime: "application/vnd.google-apps.script+json",
    resultMime: "application/json"
  }
};

export type DriveReadResult =
  | { ok: true; text: string; truncated: boolean; bytes: number; name: string; mimeType: string }
  | { ok: false; error: string };

export async function readDriveFileText(opts: {
  workspaceId: string;
  fileId: string;
}): Promise<DriveReadResult> {
  try {
    // 1. Si es Google Workspace native → exportamos.
    // No sabemos el mimeType hasta consultarlo. Probamos primero la
    // ruta de download (más común) y si Drive responde con
    // "Use Export with Google Docs" hacemos fallback.
    // En la práctica: hacemos metadata implícita vía download — si
    // mimeType empieza por application/vnd.google-apps, exportamos.
    //
    // Para no hacer 2 calls cuando es Google native, llamamos a
    // download y si falla por tipo nativo (que ya devolverá un 403
    // de Drive con mensaje), reintentamos export. Más limpio: hacer
    // metadata aparte. La verificación de parents YA la hace cada
    // función internamente, así que aquí solo gastamos 1-2 calls.
    try {
      const dl = await downloadDriveFile({
        workspaceId: opts.workspaceId,
        fileId: opts.fileId
      });
      // Si llegamos aquí, el archivo es no-nativo. Lo extraemos
      // con el file-reader normal (pero pasándole bytes directos
      // en lugar de un s3Key — usamos un atajo: escribimos a un
      // s3Key fake no funciona, así que duplicamos la lógica).
      return await extractFromBuffer({
        buffer: dl.buffer,
        mimeType: dl.mimeType,
        name: dl.name
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // Drive devuelve 403 con mensaje específico para Google native.
      if (!/only files with binary content can be downloaded|Use Export/i.test(msg)) {
        // Si el error NO es "es Google native", lo propagamos tal cual.
        return { ok: false, error: msg };
      }
    }

    // 2. Es Google native → export. Necesitamos saber el mimeType
    // para elegir el export correcto. Como downloadDriveFile ya hizo
    // la metadata fetch, repetimos aquí — coste aceptable.
    // Para evitar hacer otra metadata call, probamos sequentially
    // los exports más comunes hasta que uno funcione.
    for (const sourceMime of Object.keys(GOOGLE_NATIVE_EXPORTS)) {
      const cfg = GOOGLE_NATIVE_EXPORTS[sourceMime];
      try {
        const exp = await exportDriveFile({
          workspaceId: opts.workspaceId,
          fileId: opts.fileId,
          exportMimeType: cfg.exportMime
        });
        // Si el export se hizo y el sourceMimeType coincide, OK.
        // Si Drive permitió el export sobre otro tipo (caso raro),
        // igualmente devolvemos.
        if (exp.sourceMimeType !== sourceMime) continue;
        return await extractFromBuffer({
          buffer: exp.buffer,
          mimeType: cfg.resultMime,
          name: exp.name
        });
      } catch {
        // Probamos el siguiente
        continue;
      }
    }
    return {
      ok: false,
      error: "Archivo nativo de Google Workspace de tipo no soportado (no es Doc/Sheet/Slide)."
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

async function extractFromBuffer(opts: {
  buffer: Buffer;
  mimeType: string;
  name: string;
}): Promise<DriveReadResult> {
  const mime = (opts.mimeType ?? "").toLowerCase();
  const lower = opts.name.toLowerCase();
  try {
    // Texto plano directo
    if (
      mime.startsWith("text/") ||
      mime === "application/json" ||
      mime === "application/xml" ||
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".csv") ||
      lower.endsWith(".json")
    ) {
      return wrap(opts.buffer.toString("utf8"), opts.buffer.length, opts.name, opts.mimeType);
    }
    if (mime === "application/pdf" || lower.endsWith(".pdf")) {
      const mod: any = await import("pdf-parse");
      const PDFParse = mod.PDFParse ?? mod.default?.PDFParse ?? mod.default;
      const parser = new PDFParse({ data: opts.buffer });
      const result = await parser.getText();
      const text =
        typeof result === "string"
          ? result
          : result?.text ?? result?.pages?.map((p: any) => p.text ?? "").join("\n\n") ?? "";
      return wrap(text, opts.buffer.length, opts.name, opts.mimeType);
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lower.endsWith(".docx")
    ) {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer: opts.buffer });
      return wrap(r.value ?? "", opts.buffer.length, opts.name, opts.mimeType);
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls")
    ) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(opts.buffer, { type: "buffer" });
      const parts = wb.SheetNames.map(
        (n) => `### Hoja: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`
      );
      return wrap(parts.join("\n\n"), opts.buffer.length, opts.name, opts.mimeType);
    }
    if (mime.startsWith("image/")) {
      return {
        ok: false,
        error: `Es una imagen (${mime}). Usa analyze_image_from_url si quieres analizarla — pero ojo, solo soporta adjuntos del task, no Drive todavía.`
      };
    }
    return { ok: false, error: `Tipo no soportado en Drive: ${mime || lower}` };
  } catch (e: any) {
    return { ok: false, error: `Extracción falló: ${e?.message ?? e}` };
  }
}

function wrap(text: string, bytes: number, name: string, mimeType: string): DriveReadResult {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_TEXT_CHARS) {
    return { ok: true, text: trimmed, truncated: false, bytes, name, mimeType };
  }
  return {
    ok: true,
    text: trimmed.slice(0, MAX_TEXT_CHARS) + `\n\n[…TRUNCADO en ${MAX_TEXT_CHARS} chars de ${trimmed.length} totales…]`,
    truncated: true,
    bytes,
    name,
    mimeType
  };
}
