/**
 * Descarga segura de páginas web (anti-SSRF: solo IPs públicas, DNS fijado,
 * redirecciones limitadas y tamaño máximo). Portado del Hub
 * (lib/leads/email-extract.ts) para el contexto mensual del Editorial.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";

function domainOf(url: string): string | null {
  try {
    const u = new URL(/^https?:/.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function parseIpv6(address: string): number[] | null {
  let value = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const ipv4Tail = value.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = ipv4Tail.split(".").map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    value = value.slice(0, -ipv4Tail.length) + `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.flatMap((group) => {
    const word = Number.parseInt(group, 16);
    return [word >> 8, word & 0xff];
  });
}

export function isPrivateIp(address: string): boolean {
  const clean = address.replace(/^\[|\]$/g, "");
  if (isIP(clean) === 4) {
    const [a, b, c] = clean.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  const bytes = parseIpv6(clean);
  if (!bytes) return true;
  const embeddedV4 = (offset: number) => `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateIp(embeddedV4(12));
  // Direcciones IPv4-compatible (::/96) pueden alcanzar IPv4 local según la pila.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return true;
  // NAT64 well-known 64:ff9b::/96: inspecciona el IPv4 embebido.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0)) return isPrivateIp(embeddedV4(12));
  // 6to4 incluye IPv4 en los bytes 2..5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02 && isPrivateIp(embeddedV4(2))) return true;
  return (bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    bytes[0] === 0xff || (bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] === 0x0d && bytes[3] === 0xb8 || bytes[2] === 0 && bytes[3] === 0)) ||
    (bytes[0] === 0x01 && bytes.slice(1, 8).every((byte) => byte === 0));
}

async function assertPublicWebUrl(raw: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported_protocol");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error("private_host");
  }
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) throw new Error("private_host");
  const selected = addresses[0];
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

const MAX_HTML_BYTES = 800_000;

/**
 * Petición HTTP con la resolución DNS ya validada fijada en `lookup`. Así el
 * socket no puede resolver de nuevo el dominio hacia una IP privada (rebinding).
 * El cuerpo se consume como stream y se corta antes de superar el límite.
 */
async function requestText(target: { url: URL; address: string; family: 4 | 6 }): Promise<{ status: number; location: string | null; contentType: string; text: string }> {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === "https:" ? https : http;
    const req = transport.request(target.url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NegocioVivoBot/1.0)", Accept: "text/html" },
      lookup: ((_: string, options: any, callback: any) => {
        if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      }) as any
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      const contentType = String(res.headers["content-type"] ?? "");
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > MAX_HTML_BYTES) {
        res.destroy();
        reject(new Error("response_too_large"));
        return;
      }
      if ((status >= 300 && status < 400) || status < 200 || status >= 400) {
        res.resume();
        resolve({ status, location, contentType, text: "" });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_HTML_BYTES) {
          res.destroy(new Error("response_too_large"));
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => resolve({ status, location, contentType, text: Buffer.concat(chunks, total).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(8000, () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchText(initialUrl: string, allowedDomain?: string): Promise<string> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect++) {
    if (allowedDomain && domainOf(current) !== allowedDomain) return "";
    const target = await assertPublicWebUrl(current);
    const response = await requestText(target);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) return "";
      const next = new URL(response.location, target.url).toString();
      if (allowedDomain && domainOf(next) !== allowedDomain) return "";
      current = next;
      continue;
    }
    if (response.status === 429 || response.status >= 500) throw new Error(`transient_http_${response.status}`);
    if (response.status < 200 || response.status >= 300) return "";
    if (response.contentType && !/text|html/i.test(response.contentType)) return "";
    return response.text;
  }
  throw new Error("too_many_redirects");
}
