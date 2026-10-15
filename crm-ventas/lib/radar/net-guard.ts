// Hosts a los que el navegador del radar nunca debe llegar (red interna).
// Mira el nombre/IP literal de la petición. No resuelve DNS (la intercepción de
// Playwright solo ve el host literal, no la IP final): la protección completa
// frente a "DNS rebinding" se hace en la capa de red (proxy/Browserless con su
// propio control de salida). Aquí se bloquean todas las formas LITERALES de
// apuntar a la red interna, incluidas las abreviadas.

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // metadatos cloud
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reservado
  return false;
}

// Acepta las variantes que Chromium/los navegadores expanden a una IPv4:
// "10.0.0.1", "127.1", "10.1", "0x7f.1", "2130706433" (entero), etc.
function ipv4PartsFromHost(host: string): [number, number] | null {
  if (!/^[0-9a-fx.]+$/i.test(host)) return null;
  const rawParts = host.split(".");
  if (rawParts.length === 0 || rawParts.length > 4) return null;
  const parse = (s: string): number | null => {
    if (s === "") return null;
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(s)) n = parseInt(s, 16);
    else if (/^0[0-7]*$/.test(s) && s !== "0") n = parseInt(s, 8);
    else if (/^[0-9]+$/.test(s)) n = parseInt(s, 10);
    else return null;
    return Number.isFinite(n) ? n : null;
  };
  const nums = rawParts.map(parse);
  if (nums.some((n) => n === null)) return null;
  const vals = nums as number[];
  // Forma de 1 parte (entero de 32 bits): p. ej. 2130706433 → 127.0.0.1
  if (vals.length === 1) {
    const n = vals[0];
    if (n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff];
  }
  // El primer octeto y (cuando existe) el segundo deciden el rango privado; el
  // último valor de las formas abreviadas cubre los octetos restantes.
  const a = vals[0];
  const b = vals.length >= 3 ? vals[1] : vals.length === 2 ? (vals[1] >>> 16) & 0xff : 0;
  if (a < 0 || a > 255) return null;
  return [a & 0xff, b & 0xff];
}

export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true;
  if (!host.includes(".") && !host.includes(":")) return true; // nombres sueltos de la red interna
  const v4 = ipv4PartsFromHost(host);
  if (v4 && isPrivateIpv4(v4[0], v4[1])) return true;
  if (host.includes(":")) {
    // IPv6 literal: loopback, no especificada, link-local, ULA.
    if (host === "::1" || host === "::" || host.startsWith("fe80") || /^f[cd]/.test(host)) return true;
    // IPv4 mapeada/compatible en forma decimal: ::ffff:10.0.0.1
    const decMapped = host.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
    if (decMapped) {
      const v = ipv4PartsFromHost(decMapped[1]);
      if (v && isPrivateIpv4(v[0], v[1])) return true;
    }
    // IPv4 mapeada/compatible en forma hex: ::ffff:0a00:0001 / ::7f00:1
    const hexMapped = host.match(/(?:^|:):(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      if (Number.isFinite(hi) && isPrivateIpv4((hi >>> 8) & 0xff, hi & 0xff)) return true;
    }
  }
  return false;
}
