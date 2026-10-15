// Hosts a los que el navegador del radar nunca debe llegar (red interna).
// Solo mira el nombre/IP literal; los portales son URLs fijas del catálogo.

function ipv4Private(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // metadatos cloud
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;
  return false;
}

export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true;
  if (!host.includes(".") && !host.includes(":")) return true; // nombres sueltos de la red interna
  if (ipv4Private(host)) return true;
  if (host.includes(":")) {
    // IPv6 literal: loopback, link-local, ULA y mapeadas a IPv4.
    if (host === "::1" || host === "::" || host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) return true;
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped && ipv4Private(mapped[1])) return true;
  }
  return false;
}
