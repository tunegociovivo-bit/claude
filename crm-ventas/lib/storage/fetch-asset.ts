import { readOwnFile } from "./r2";

/**
 * Descarga un recurso (logo, referencia, imagen generada) para procesarlo en
 * el servidor. Los archivos propios del CRM (/api/files/...) se leen directo
 * de la base de datos: no dependen de que la firma de la URL siga vigente ni
 * de que la app pueda llamarse a sí misma por HTTP.
 */
export async function fetchAssetBuffer(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ buffer: Buffer; contentType: string }> {
  const own = await readOwnFile(url);
  if (own) return own;
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error("data URL no válida");
    const buffer = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    return { buffer, contentType: m[1] || "application/octet-stream" };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error(`URL no descargable: ${url.slice(0, 60)}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar ${url.slice(0, 80)}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (opts.maxBytes && buffer.length > opts.maxBytes) throw new Error("Archivo demasiado grande");
    return { buffer, contentType: resp.headers.get("content-type") ?? "application/octet-stream" };
  } finally {
    clearTimeout(timer);
  }
}
