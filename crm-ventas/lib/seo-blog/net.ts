/**
 * Peticiones HTTP a la web WordPress del negocio (y a webs de la competencia).
 *
 * En el CRM la URL la escribe el propio negocio, así que el servidor no debe
 * poder usarse para llegar a su red interna (SSRF):
 *  · solo http/https hacia IPs públicas (se resuelve el DNS, se valida y la
 *    conexión se hace a ESA IP: sin DNS rebinding);
 *  · cada redirección se vuelve a validar;
 *  · las credenciales (Authorization / X-NV-Auth) no se reenvían si la
 *    redirección cambia de dominio (se permite http→https y con/sin «www.»);
 *  · tamaño máximo de respuesta.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { isPrivateIp } from "@/lib/leads/email-extract";

export class UnsafeUrlError extends Error {}

type Target = { url: URL; address: string; family: 4 | 6 };

const PRIVATE_MSG = "La dirección apunta a una red privada y no está permitida";

/** Valida la URL y devuelve la IP pública a la que hay que conectarse. */
export async function resolvePublicTarget(raw: string): Promise<Target> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL no válida");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Solo se admiten direcciones http(s)");
  if (url.username || url.password) throw new UnsafeUrlError("La URL no puede llevar usuario ni contraseña");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) throw new UnsafeUrlError(PRIVATE_MSG);
  const ipKind = isIP(host);
  if (ipKind) {
    if (isPrivateIp(host)) throw new UnsafeUrlError(PRIVATE_MSG);
    return { url, address: host, family: ipKind as 4 | 6 };
  }
  let addrs: { address: string; family: number }[] = [];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    addrs = [];
  }
  if (!addrs.length) throw new UnsafeUrlError(`No se encuentra el dominio ${host}`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError(PRIVATE_MSG);
  const pick = addrs.find((a) => a.family === 4) ?? addrs[0];
  return { url, address: pick.address, family: pick.family as 4 | 6 };
}

/** Compatibilidad: solo valida (sin devolver la IP). */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  return (await resolvePublicTarget(raw)).url;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

function toBuffer(body: BodyInit | null | undefined): Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new Error("Tipo de cuerpo no soportado en safeFetch");
}

/** Una petición HTTP conectando a la IP ya validada (Host y SNI siguen siendo el dominio). */
function pinnedRequest(
  t: Target,
  opts: { method: string; headers: Headers; body?: Buffer; signal?: AbortSignal | null; maxBytes: number }
): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(opts.signal.reason ?? new Error("Petición cancelada"));
    let settled = false;
    const cleanup = () => opts.signal?.removeEventListener("abort", onAbort);
    const ok = (r: Response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(r);
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const headers: Record<string, string> = {};
    opts.headers.forEach((v, k) => (headers[k] = v));
    if (!headers["accept-encoding"]) headers["accept-encoding"] = "gzip, deflate, br";
    if (opts.body) headers["content-length"] = String(opts.body.length);
    const transport = t.url.protocol === "https:" ? https : http;
    const req = transport.request(
      t.url,
      {
        method: opts.method,
        headers,
        lookup: ((_h: string, o: any, cb: any) => {
          if (o?.all) cb(null, [{ address: t.address, family: t.family }]);
          else cb(null, t.address, t.family);
        }) as any
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const outHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          for (const item of Array.isArray(v) ? v : [v]) outHeaders.append(k, String(item));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          return fail(new Error("La respuesta es demasiado grande"));
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        let stream: NodeJS.ReadableStream = res;
        if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
        if (stream !== res) {
          outHeaders.delete("content-encoding");
          outHeaders.delete("content-length");
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("error", fail);
        res.on("close", () => {
          if (!res.complete) fail(new Error("La conexión se cerró antes de terminar la respuesta"));
        });
        stream.on("error", fail);
        stream.on("data", (c: Buffer) => {
          total += c.length;
          if (total > opts.maxBytes) {
            res.destroy();
            fail(new Error("La respuesta es demasiado grande"));
            return;
          }
          chunks.push(c);
        });
        stream.on("end", () => {
          try {
            const buf = Buffer.concat(chunks, total);
            const r = new Response(!NULL_BODY.has(status) && opts.method !== "HEAD" ? new Uint8Array(buf) : null, {
              status: status >= 200 && status <= 599 ? status : 502,
              statusText: res.statusMessage ?? "",
              headers: outHeaders
            });
            Object.defineProperty(r, "url", { value: t.url.toString() });
            ok(r);
          } catch (e) {
            fail(e);
          }
        });
      }
    );
    function onAbort() {
      const reason = opts.signal?.reason;
      const err = reason instanceof Error ? reason : new Error("Tiempo de espera agotado");
      req.destroy(err);
      fail(err);
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", fail);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

/**
 * fetch() seguro: valida cada salto (incluidas las redirecciones) y conecta a la
 * IP validada. Devuelve un Response estándar; `r.url` es la URL final.
 */
export async function safeFetch(input: string, init: RequestInit & { maxBytes?: number } = {}, maxRedirects = 5): Promise<Response> {
  let current = input;
  let method = (init.method ?? "GET").toUpperCase();
  let body = toBuffer(init.body as BodyInit | null | undefined);
  const headers = new Headers(init.headers as HeadersInit | undefined);
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
  for (let hop = 0; ; hop++) {
    const target = await resolvePublicTarget(current);
    const r = await pinnedRequest(target, { method, headers, body, signal: init.signal, maxBytes });
    const location = r.headers.get("location");
    if (r.status < 300 || r.status >= 400 || !location || init.redirect === "manual") return r;
    if (hop >= maxRedirects) throw new Error("Demasiadas redirecciones");
    const next = new URL(location, target.url);
    if ((r.status === 303 && method !== "HEAD") || ((r.status === 301 || r.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      headers.delete("content-type");
      headers.delete("content-disposition");
    }
    if (bareHost(next.hostname) !== bareHost(target.url.hostname)) {
      headers.delete("authorization");
      headers.delete("x-nv-auth");
    }
    current = next.toString();
  }
}

/**
 * Descarga un recurso de una web externa (anti-SSRF en cada salto, tamaño máximo).
 * Para archivos propios del CRM o data: URLs usa `fetchAssetBuffer` (no pasa por aquí).
 */
export async function safeDownload(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<Buffer> {
  const max = opts.maxBytes ?? 25 * 1024 * 1024;
  const r = await safeFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000), maxBytes: max });
  if (!r.ok) throw new Error(`HTTP ${r.status} al descargar ${url.slice(0, 80)}`);
  return Buffer.from(await r.arrayBuffer());
}
