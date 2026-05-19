/**
 * Web scraping dinámico vía Browserless.io (managed Chromium).
 *
 * El tool `http_request` actual solo hace fetch HTTP plano — sites
 * con JavaScript pesado (Instagram público, Shopify storefronts,
 * Notion públicas, SPAs en general) devuelven un HTML casi vacío
 * porque el contenido lo monta JS en el cliente.
 *
 * Browserless.io expone Chrome headless vía API HTTP. Ventaja sobre
 * Playwright local: no necesitamos descargar Chromium (150MB+) en
 * Railway ni preocuparnos del entorno. Coste: ~$0.005 por scrape.
 *
 * Config: env `BROWSERLESS_API_KEY` (sign up en https://browserless.io
 * → 1000 unidades/mes gratis, suficiente para 200-300 scrapes mes).
 * Si NO está configurado, fallback: env `SCRAPE_PROXY_URL` apunta a
 * un servicio propio compatible (puppeteer-as-a-service, etc.).
 *
 * Anti-SSRF: misma blocklist que http_request (sin localhost, IPs
 * privadas, metadata endpoints). Cap respuesta 5MB.
 */

const BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "169.254.169.254",
  "metadata.google.internal"
];
const BLOCKED_PATTERNS = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.internal$/,
  /\.local$/
];

function isUrlAllowed(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(host)) return false;
  if (BLOCKED_PATTERNS.some((p) => p.test(host))) return false;
  if (!["http:", "https:"].includes(url.protocol)) return false;
  return true;
}

export type ScrapeDynamicResult = {
  ok: true;
  finalUrl: string;
  status: number;
  html: string;
  truncated: boolean;
  screenshotUrl?: string;
};

export async function scrapeDynamic(opts: {
  url: string;
  /** Para subir screenshot a R2 con el bucket/key del workspace. */
  workspaceId: string;
  /** CSS selector a esperar antes de capturar HTML (más fiable que
   *  esperar load event en SPAs). */
  waitForSelector?: string;
  /** Tiempo extra después de load antes de capturar, en ms. Default 1500. */
  waitMs?: number;
  /** Si true, también captura screenshot PNG y lo sube a R2. */
  screenshot?: boolean;
  /** Timeout total en ms. Default 30s, max 60s. */
  timeoutMs?: number;
}): Promise<ScrapeDynamicResult> {
  const apiKey = process.env.BROWSERLESS_API_KEY;
  const proxyUrl = process.env.SCRAPE_PROXY_URL;
  if (!apiKey && !proxyUrl) {
    throw new Error(
      "Scraping dinámico no configurado. Define BROWSERLESS_API_KEY (https://browserless.io, 1000 unidades gratis/mes) o SCRAPE_PROXY_URL (servicio propio compatible) en env."
    );
  }

  const parsed = new URL(opts.url);
  if (!isUrlAllowed(parsed)) {
    throw new Error(`URL bloqueada por anti-SSRF: ${parsed.hostname}`);
  }

  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 30_000, 5_000), 60_000);
  const waitMs = Math.min(Math.max(opts.waitMs ?? 1500, 0), 10_000);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    // Browserless.io API: POST /content para HTML, /screenshot para PNG.
    const base = apiKey ? "https://chrome.browserless.io" : proxyUrl!;
    const contentEndpoint = `${base}/content${apiKey ? `?token=${apiKey}` : ""}`;

    const body: any = {
      url: opts.url,
      gotoOptions: { waitUntil: "networkidle2", timeout: timeoutMs - 2000 },
      waitFor: opts.waitForSelector ? opts.waitForSelector : waitMs
    };

    const r = await fetch(contentEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Browserless ${r.status}: ${t.slice(0, 300)}`);
    }
    const html = await r.text();
    const truncated = html.length > 5_000_000;
    const finalHtml = truncated ? html.slice(0, 5_000_000) + "\n<!-- TRUNCATED -->" : html;

    let screenshotUrl: string | undefined;
    if (opts.screenshot) {
      try {
        const ssEndpoint = `${base}/screenshot${apiKey ? `?token=${apiKey}` : ""}`;
        const ssResp = await fetch(ssEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: opts.url,
            options: { fullPage: false, type: "png" },
            gotoOptions: { waitUntil: "networkidle2", timeout: timeoutMs - 2000 }
          }),
          signal: ctrl.signal
        });
        if (ssResp.ok) {
          const buf = Buffer.from(await ssResp.arrayBuffer());
          // Subir a R2 (si está configurado) y devolver URL firmada.
          const { uploadBuffer, buildS3Key, signedDownloadUrl, isStorageEnabled } =
            await import("@/lib/storage/r2");
          if (isStorageEnabled()) {
            const s3Key = buildS3Key({
              workspaceId: opts.workspaceId,
              targetType: null,
              targetId: null,
              filename: `scrape-screenshot-${Date.now()}.png`
            });
            await uploadBuffer({ s3Key, body: buf, contentType: "image/png" });
            screenshotUrl = await signedDownloadUrl(s3Key);
          }
        }
      } catch {
        // Screenshot es bonus — si falla, devolvemos HTML solo
      }
    }

    return {
      ok: true,
      finalUrl: opts.url,
      status: r.status,
      html: finalHtml,
      truncated,
      screenshotUrl
    };
  } finally {
    clearTimeout(timer);
  }
}
