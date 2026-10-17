import { parseAndroidUiNodes, type AndroidUiNode } from "./android-ui-hierarchy";
import { validateWebQa, webQaLaunchUrl, type WebQaTemplate, type WebQaReport } from "@/lib/mobile/web-qa";

export type HubWebQaDependencies = {
  readAddress: () => Promise<string>;
  readPage: () => Promise<string>;
  openUrl: (url: string) => Promise<void>;
  swipe: (from: { x: number; y: number }, to: { x: number; y: number }) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export function readChromeQaAddress(xml: string): URL {
  const node = parseAndroidUiNodes(xml).find((item) => item.packageName === "com.android.chrome"
    && /(?:^|\/)url_bar$/.test(item.resourceId) && item.focused && item.className === "android.widget.EditText");
  if (!node?.text || /\s/.test(node.text)) throw new Error("Chrome no ha permitido verificar la URL. La prueba se ha detenido sin pulsar en la pagina.");
  const url = new URL(node.text.includes("://") ? node.text : `https://${node.text}`);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("La pagina actual no es una URL HTTPS autorizada.");
  return url;
}

export function qaScrollArea(xml: string): AndroidUiNode["bounds"] {
  const node = parseAndroidUiNodes(xml).filter((item) => item.packageName === "com.android.chrome"
    && item.className === "android.webkit.WebView" && item.bounds.bottom - item.bounds.top >= 200 && item.bounds.right - item.bounds.left >= 150)
    .sort((a, b) => (b.bounds.bottom - b.bounds.top) - (a.bounds.bottom - a.bounds.top))[0];
  if (!node) throw new Error("No se ha encontrado una pagina web visible en Chrome. No se enviaran gestos a otras aplicaciones.");
  return node.bounds;
}

export async function runHubWebQa(input: WebQaTemplate, id: string, deps: HubWebQaDependencies, signal: AbortSignal, onProgress: (report: WebQaReport) => void): Promise<WebQaReport> {
  const config = validateWebQa(input);
  // Validate the identifier before any device operation.
  webQaLaunchUrl(config, id);
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const startedAt = now();
  const deadline = startedAt + config.seconds * 1000;
  let report: WebQaReport = { id, status: "running", startedAt, seconds: config.seconds, events: [] };
  let navigations = 0;
  const publish = () => onProgress({ ...report, events: [...report.events] });
  const record = (action: WebQaReport["events"][number]["action"], path?: string, detail?: string) => {
    report.events.push({ at: now(), action, ...(path ? { path } : {}), ...(detail ? { detail: detail.slice(0, 300) } : {}) }); publish();
  };
  const check = () => {
    if (signal.aborted) throw new Error("Prueba detenida por el operador o por desconexion del movil.");
    if (now() >= deadline) throw new Error("deadline");
  };
  const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
      const result = await Promise.race([operation(), new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Prueba detenida por el operador o por desconexion del movil."));
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => reject(new Error("deadline")), Math.max(1, deadline - now()));
      })]);
      check(); return result;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  };
  const verify = async () => {
    const url = readChromeQaAddress(await guarded(deps.readAddress));
    url.search = ""; url.hash = "";
    if (!config.urls.includes(url.href)) throw new Error("La URL visible no esta en el recorrido autorizado. La prueba se ha detenido.");
    return url;
  };
  try {
    record("start");
    await verify();
    await guarded(() => deps.openUrl(webQaLaunchUrl(config, id)));
    record("navigate", new URL(config.urls[0]).pathname); navigations += 1;
    await guarded(() => deps.wait(3000));
    while (now() < deadline && report.events.length < 190) {
      const current = await verify();
      const bounds = qaScrollArea(await guarded(deps.readPage));
      const alternatives = config.urls.map((url, index) => ({ url, index })).filter((item) => item.url !== current.href);
      if (alternatives.length && navigations < 20 && random() < 0.25) {
        const next = alternatives[Math.min(alternatives.length - 1, Math.floor(random() * alternatives.length))];
        await guarded(() => deps.openUrl(webQaLaunchUrl(config, id, next.index)));
        record("navigate", new URL(next.url).pathname); navigations += 1;
      } else {
        const x = Math.round((bounds.left + bounds.right) / 2);
        const height = bounds.bottom - bounds.top;
        const down = random() >= 0.2;
        const upper = Math.round(bounds.top + height * 0.3);
        const lower = Math.round(bounds.top + height * 0.7);
        await guarded(() => deps.swipe({ x, y: down ? lower : upper }, { x, y: down ? upper : lower }));
        record("scroll", current.pathname, down ? "abajo" : "arriba");
      }
      await guarded(() => deps.wait(3000 + Math.floor(random() * 4000)));
    }
    report.status = "completed";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "No se pudo completar el recorrido.";
    report.status = signal.aborted ? "stopped" : detail === "deadline" ? "completed" : "failed";
    if (report.status === "failed") { report.error = detail.slice(0, 300); record("error", undefined, detail); }
  }
  report = { ...report, finishedAt: now() }; record("finish"); return report;
}
