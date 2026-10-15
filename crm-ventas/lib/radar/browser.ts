import "server-only";
import type { Browser, BrowserContext } from "playwright-core";
import { isPrivateHost } from "./net-guard";

// Navegador del radar. En producción se conecta a un Chrome remoto (servicio
// Browserless en el mismo proyecto de Railway) por CDP: así el CRM no necesita
// Chrome instalado. En local/tests lanza el Chromium indicado.
//   RADAR_BROWSER_WS_URL  ws(s)://…/chromium?token=…   (Browserless v2)
//   RADAR_CHROMIUM_PATH   ruta a un Chromium local
//   RADAR_PROXY_URL       proxy opcional (http://usuario:clave@host:puerto)

export class RadarBrowserUnavailableError extends Error {
  constructor(message = "El navegador del radar no está configurado (falta RADAR_BROWSER_WS_URL). Avisa a Negocio Vivo.") {
    super(message);
    this.name = "RadarBrowserUnavailableError";
  }
}

export function radarBrowserConfigured(): boolean {
  return Boolean(process.env.RADAR_BROWSER_WS_URL || process.env.RADAR_CHROMIUM_PATH);
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function proxySettings(): { server: string; username?: string; password?: string } | undefined {
  const raw = process.env.RADAR_PROXY_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.host}`,
      ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Abre un navegador nuevo (uno por portal: si un portal lo cuelga, no afecta a los demás). */
export async function openBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const ws = process.env.RADAR_BROWSER_WS_URL;
  if (ws) {
    let endpoint = ws;
    const proxy = process.env.RADAR_PROXY_URL;
    // Browserless acepta el proxy como parámetro de la conexión.
    if (proxy && !/[?&]--proxy-server=/.test(endpoint)) {
      try {
        const p = new URL(proxy);
        endpoint += `${endpoint.includes("?") ? "&" : "?"}--proxy-server=${encodeURIComponent(`${p.protocol}//${p.host}`)}`;
      } catch {
        // Proxy mal escrito: se conecta sin él.
      }
    }
    return chromium.connectOverCDP(endpoint, { timeout: 60_000 });
  }
  const executablePath = process.env.RADAR_CHROMIUM_PATH;
  if (!executablePath) throw new RadarBrowserUnavailableError();
  return chromium.launch({
    executablePath,
    headless: true,
    proxy: proxySettings(),
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/** Contexto con aspecto de navegador normal en España y sesión previa si la hay. */
export async function newRadarContext(browser: Browser, storageState?: unknown): Promise<BrowserContext> {
  // El proxy (si lo hay) va en el navegador, no en el contexto.
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1440, height: 900 },
    ...(storageState && typeof storageState === "object" ? { storageState: storageState as any } : {}),
  });
  // Oculta la marca de automatización más evidente.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  // Anti-SSRF: las páginas de los portales no pueden llegar a la red interna
  // (servicios de Railway, metadatos, localhost…).
  await context.route("**/*", async (route) => {
    let host = "";
    let protocol = "";
    try {
      const url = new URL(route.request().url());
      host = url.hostname;
      protocol = url.protocol;
    } catch {
      return route.abort();
    }
    if (protocol === "data:" || protocol === "blob:" || protocol === "about:") return route.continue();
    // Solo para pruebas locales con portales simulados (nunca en Railway).
    const allowPrivate = process.env.RADAR_ALLOW_PRIVATE_HOSTS === "1";
    if (!["http:", "https:", "wss:", "ws:"].includes(protocol) || (!allowPrivate && isPrivateHost(host))) return route.abort("blockedbyclient");
    // Imágenes, fuentes y vídeos no hacen falta: menos datos y más rápido.
    const type = route.request().resourceType();
    if (type === "image" || type === "media" || type === "font") return route.abort("blockedbyclient");
    return route.continue();
  });
  return context;
}

export async function closeQuietly(target: { close: () => Promise<unknown> } | null | undefined) {
  if (!target) return;
  await Promise.race([target.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
}
