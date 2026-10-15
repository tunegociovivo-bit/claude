import "server-only";
import type { Page } from "playwright-core";
import { dismissCookies } from "./login";
import { extractVehiclesFromJson, type ExtractedVehicle, type VehicleMapOptions } from "./extract-json";
import { aiExtractVehicles } from "./ai-extract";

// Recogida de coches de un portal ya con la sesión iniciada:
//  1) escucha las respuestas JSON que la web pide a su propia API y saca los coches;
//  2) recorre las páginas de resultados (scroll, «Ver más», «Siguiente»);
//  3) si no hay JSON reconocible, lee las fichas visibles con IA (si se permite).

export type CollectOptions = {
  workspaceId: string;
  listingUrls: string[];
  deadline: number; // ms epoch
  maxVehicles: number;
  maxPages?: number;
  map?: VehicleMapOptions;
  jsonUrlFilter?: (url: string) => boolean;
  allowAi: boolean;
  log: (msg: string) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MORE_BUTTON = /^(ver m[aá]s|cargar m[aá]s|mostrar m[aá]s|load more|show more|voir plus|mehr anzeigen|mehr laden)/i;
const NEXT_BUTTON = /^(siguiente|next|suivant|weiter|›|»|>)$/i;

/** Acumula coches de todas las respuestas JSON que vea el navegador. */
function attachJsonSniffer(page: Page, opts: CollectOptions, sink: Map<string, ExtractedVehicle>) {
  page.on("response", (response) => {
    void (async () => {
      try {
        const url = response.url();
        if (opts.jsonUrlFilter && !opts.jsonUrlFilter(url)) return;
        const type = (response.headers()["content-type"] || "").toLowerCase();
        if (!type.includes("json")) return;
        if (!response.ok() && response.status() !== 206) return;
        const body = await response.json().catch(() => null);
        if (!body) return;
        for (const v of extractVehiclesFromJson(body, opts.map)) {
          if (!sink.has(v.externalId)) sink.set(v.externalId, v);
        }
      } catch {
        // Respuesta no JSON o ilegible: se ignora.
      }
    })();
  });
}

async function clickByText(page: Page, re: RegExp): Promise<boolean> {
  const loc = page.locator("button, a[role=button], [role=button], a");
  const n = Math.min(await loc.count().catch(() => 0), 80);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    const text = ((await el.innerText({ timeout: 200 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 30 && re.test(text) && (await el.isVisible().catch(() => false))) {
      await el.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
      await el.click({ timeout: 4_000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function settle(page: Page, ms = 1_800) {
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
  await sleep(ms);
}

/** Baja por la lista pidiendo más resultados hasta agotar páginas, tiempo o cupo. */
async function paginate(page: Page, opts: CollectOptions, sink: Map<string, ExtractedVehicle>) {
  const maxPages = opts.maxPages ?? 15;
  for (let p = 0; p < maxPages; p++) {
    if (Date.now() > opts.deadline || sink.size >= opts.maxVehicles) return;
    const before = sink.size;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
    await sleep(1_200);
    let advanced = await clickByText(page, MORE_BUTTON);
    if (!advanced) advanced = await clickByText(page, NEXT_BUTTON);
    await settle(page, 1_500);
    // Si ni crecen los coches ni hay más botón, se acabó.
    if (!advanced && sink.size === before) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
      await sleep(1_500);
      if (sink.size === before) return;
    }
  }
}

export async function collectVehicles(page: Page, opts: CollectOptions): Promise<ExtractedVehicle[]> {
  const sink = new Map<string, ExtractedVehicle>();
  attachJsonSniffer(page, opts, sink);

  for (const url of opts.listingUrls) {
    if (Date.now() > opts.deadline || sink.size >= opts.maxVehicles) break;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (error) {
      opts.log(`No se pudo abrir ${url}: ${(error as Error).message.split("\n")[0].slice(0, 100)}`);
      continue;
    }
    await settle(page, 2_000);
    await dismissCookies(page);
    await paginate(page, opts, sink);
    opts.log(`${url} → ${sink.size} coche(s) acumulados`);
  }

  // Respaldo con IA cuando el sniffer no encontró nada en las respuestas JSON.
  if (sink.size === 0 && opts.allowAi && Date.now() < opts.deadline) {
    opts.log("Sin JSON reconocible; leyendo las fichas visibles con IA.");
    try {
      const html = await page.content();
      const aiVehicles = await aiExtractVehicles({ workspaceId: opts.workspaceId, html, pageUrl: page.url(), map: opts.map });
      for (const v of aiVehicles) if (!sink.has(v.externalId)) sink.set(v.externalId, v);
    } catch (error) {
      opts.log(`La lectura con IA falló: ${(error as Error).message.slice(0, 120)}`);
    }
  }

  return [...sink.values()].slice(0, opts.maxVehicles);
}
