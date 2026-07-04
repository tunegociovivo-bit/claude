/**
 * Proxy por número de WhatsApp. El mayor factor de baneo de la captación en frío
 * NO es solo el volumen: es que todos los números salgan por la MISMA IP de
 * datacenter (Railway/Hetzner). WhatsApp penaliza fuerte las IPs de datacenter y
 * el compartir IP entre números. Cada número debería salir por su propio proxy
 * residencial/móvil (IP sticky).
 *
 * Config en settings.leads:
 *   - wahaProxy: proxy global por defecto (string).
 *   - channels[].proxy: proxy específico de ESE número (tiene prioridad).
 *
 * Formato aceptado (flexible):
 *   "http://user:pass@host:port"  |  "socks5://user:pass@host:port"
 *   "host:port"                   |  "user:pass@host:port"  (asume http)
 */

export type ParsedProxy = {
  protocol: string; // "http" | "https" | "socks5" | "socks4"
  host: string;
  port: string;
  username?: string;
  password?: string;
};

/** Parsea una URL de proxy flexible a sus componentes. Devuelve null si no es válida. */
export function parseProxyUrl(raw: string | null | undefined): ParsedProxy | null {
  if (!raw || !String(raw).trim()) return null;
  let s = String(raw).trim();
  if (!/:\/\//.test(s)) s = "http://" + s; // permite "host:port" o "user:pass@host:port"
  try {
    const u = new URL(s);
    if (!u.hostname || !u.port) return null;
    return {
      protocol: (u.protocol || "http:").replace(/:$/, "").toLowerCase(),
      host: u.hostname,
      port: u.port,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Proxy efectivo para una sesión/instancia: el del canal si lo tiene definido;
 * si no, el proxy global del workspace. null = sin proxy (sale por la IP del server).
 */
export function resolveProxyForSession(leads: any, sessionName?: string | null): ParsedProxy | null {
  const channels: any[] = Array.isArray(leads?.channels) ? leads.channels : [];
  if (sessionName) {
    const ch = channels.find((c) => c?.name === sessionName);
    const chProxy = parseProxyUrl(ch?.proxy);
    if (chProxy) return chProxy;
  }
  return parseProxyUrl(leads?.wahaProxy ?? leads?.proxyUrl ?? null);
}

/** Componentes de proxy para el `config.proxy` de una sesión WAHA. */
export function toWahaProxy(
  p: ParsedProxy | null
): { server: string; username?: string; password?: string } | undefined {
  if (!p) return undefined;
  // WAHA acepta "host:port" (http) o "protocolo://host:port" para socks.
  const server =
    p.protocol && p.protocol !== "http" ? `${p.protocol}://${p.host}:${p.port}` : `${p.host}:${p.port}`;
  const out: { server: string; username?: string; password?: string } = { server };
  if (p.username) out.username = p.username;
  if (p.password) out.password = p.password;
  return out;
}
