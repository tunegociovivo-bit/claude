import { readOwnFile } from "./r2";
import { safeFetch } from "@/lib/seo-blog/net";

const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;

/**
 * Descarga un recurso (logo, referencia, imagen o clip generado) para
 * procesarlo en el servidor.
 *  · Archivos propios del CRM (/api/files/...): directo de la base de datos,
 *    sin depender de la firma de la URL ni de que la app se llame a sí misma.
 *  · URLs externas: con protección anti-SSRF (solo IPs públicas, DNS fijado,
 *    cada redirección revalidada) y corte por tamaño durante la descarga, para
 *    que una URL maliciosa no alcance la red interna ni agote la memoria.
 */
export async function fetchAssetBuffer(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ buffer: Buffer; contentType: string }> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const own = await readOwnFile(url);
  if (own) return own;
  if (url.startsWith("data:")) {
    if (url.length > maxBytes * 1.4) throw new Error("Archivo demasiado grande");
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error("data URL no válida");
    const buffer = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    return { buffer, contentType: m[1] || "application/octet-stream" };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error(`URL no descargable: ${url.slice(0, 60)}`);
  const resp = await safeFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000), maxBytes });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar ${url.slice(0, 80)}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error("Archivo demasiado grande");
  return { buffer, contentType: resp.headers.get("content-type") ?? "application/octet-stream" };
}
