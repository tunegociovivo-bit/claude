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

export type ProxyCheckResult = {
  ok: boolean;
  exitIp?: string;
  ms?: number;
  error?: string;
};

/**
 * Verifica un proxy HTTP(S) haciendo un CONNECT nativo (sin dependencias) y
 * consultando un echo de IP a través de él. Devuelve la IP de salida (prueba de
 * que el proxy funciona) y la latencia, o el motivo del fallo. Solo HTTP/HTTPS
 * (los SOCKS no se pueden verificar por esta vía).
 */
export async function checkProxy(proxyUrl: string, timeoutMs = 12000): Promise<ProxyCheckResult> {
  const p = parseProxyUrl(proxyUrl);
  if (!p) return { ok: false, error: "Formato de proxy no válido (usa http://usuario:clave@host:puerto)" };
  if (p.protocol.startsWith("socks")) {
    return { ok: false, error: "El test solo soporta proxies HTTP/HTTPS, no SOCKS." };
  }
  const http = await import("node:http");
  const tls = await import("node:tls");
  const targetHost = "api.ipify.org";
  const targetPort = 443;
  const started = Date.now();

  return await new Promise<ProxyCheckResult>((resolve) => {
    let settled = false;
    let socket: any = null;
    const finish = (r: ProxyCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        /* noop */
      }
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: `Sin respuesta en ${Math.round(timeoutMs / 1000)}s (el proxy no responde)` }),
      timeoutMs
    );
    const auth = p.username
      ? "Basic " + Buffer.from(`${p.username}:${p.password ?? ""}`).toString("base64")
      : undefined;
    const req = http.request({
      host: p.host,
      port: Number(p.port),
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      timeout: timeoutMs,
      headers: { Host: `${targetHost}:${targetPort}`, ...(auth ? { "Proxy-Authorization": auth } : {}) }
    });
    req.on("connect", (res, sock) => {
      socket = sock;
      if (res.statusCode !== 200) {
        const hint = res.statusCode === 407 ? " (usuario/clave del proxy incorrectos)" : "";
        return finish({ ok: false, error: `El proxy rechazó la conexión: HTTP ${res.statusCode}${hint}` });
      }
      const tlsSock = tls.connect({ socket: sock as any, servername: targetHost }, () => {
        tlsSock.write(
          `GET /?format=json HTTP/1.1\r\nHost: ${targetHost}\r\nUser-Agent: nv-leads-proxy-check\r\nConnection: close\r\n\r\n`
        );
      });
      let raw = "";
      tlsSock.on("data", (d) => {
        raw += d.toString("utf8");
      });
      tlsSock.on("end", () => {
        const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim();
        let ip: string | undefined;
        try {
          ip = JSON.parse(body).ip;
        } catch {
          ip = body.match(/\d{1,3}(?:\.\d{1,3}){3}/)?.[0];
        }
        if (ip) finish({ ok: true, exitIp: ip, ms: Date.now() - started });
        else finish({ ok: false, error: "Respuesta inesperada del verificador de IP" });
      });
      tlsSock.on("error", (e: Error) => finish({ ok: false, error: `Error TLS a través del proxy: ${e.message}` }));
    });
    req.on("timeout", () => finish({ ok: false, error: `Timeout al conectar con el proxy (${p.host}:${p.port})` }));
    req.on("error", (e: Error) => finish({ ok: false, error: `No se pudo conectar al proxy: ${e.message}` }));
    req.end();
  });
}

/**
 * Barrido de todos los proxies configurados (global + por canal). Guarda el
 * estado en settings.leads.proxyStatus para que la UI muestre badges/avisos.
 * Está throttleado (por defecto máx. 1 vez cada 15 min) para no saturar.
 * Marca `justFailed` cuando un proxy que estaba OK pasa a fallar (para el aviso).
 */
export async function checkAllProxiesForWorkspace(
  workspaceId: string,
  opts?: { force?: boolean; minIntervalMs?: number }
): Promise<Record<string, ProxyCheckResult & { checkedAt: string; justFailed?: boolean }>> {
  const { prisma } = await import("@/lib/db/prisma");
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = ws?.settings ?? {};
  const leads: any = settings.leads ?? {};
  const minInterval = opts?.minIntervalMs ?? 15 * 60 * 1000;
  const last = leads.lastProxySweepAt ? Date.parse(leads.lastProxySweepAt) : 0;
  if (!opts?.force && last && Date.now() - last < minInterval) return leads.proxyStatus ?? {};

  const targets: { key: string; proxy: string }[] = [];
  if (leads.wahaProxy && String(leads.wahaProxy).trim()) targets.push({ key: "__global__", proxy: String(leads.wahaProxy) });
  for (const c of Array.isArray(leads.channels) ? leads.channels : []) {
    if (c?.proxy && String(c.proxy).trim() && c?.name) targets.push({ key: c.name, proxy: String(c.proxy) });
  }

  const status: any = leads.proxyStatus ?? {};
  for (const t of targets) {
    const prev = status[t.key];
    const r = await checkProxy(t.proxy).catch((e) => ({ ok: false, error: String(e?.message ?? e) }) as ProxyCheckResult);
    status[t.key] = { ...r, checkedAt: new Date().toISOString(), justFailed: !!(prev?.ok && !r.ok) };
  }
  // Limpia entradas de proxies que ya no existen.
  const valid = new Set(targets.map((t) => t.key));
  for (const k of Object.keys(status)) if (!valid.has(k)) delete status[k];

  leads.proxyStatus = status;
  leads.lastProxySweepAt = new Date().toISOString();
  settings.leads = leads;
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } }).catch(() => {});
  return status;
}
