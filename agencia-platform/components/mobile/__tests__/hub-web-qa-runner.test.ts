import { describe, expect, it } from "vitest";
import { qaScrollArea, readChromeQaAddress, runHubWebQa, type HubWebQaDependencies } from "../hub-web-qa-runner";
import type { WebQaReport } from "@/lib/mobile/web-qa";

const id = "12345678-1234-1234-1234-123456789abc";
const config = { name: "Test", keyword: "negocio", business: "Negocio", urls: ["https://example.com/", "https://example.com/servicios/"], seconds: 30 };
const address = (url: string, focused = true, pkg = "com.android.chrome") => `<hierarchy><node text="${url}" resource-id="${pkg}:id/url_bar" package="${pkg}" class="android.widget.EditText" focused="${focused}" bounds="[10,50][600,100]" /></hierarchy>`;
const page = '<hierarchy><node text="" package="com.android.chrome" class="android.webkit.WebView" bounds="[0,150][720,1400]" /></hierarchy>';
function fixture() {
  let clock = 1000;
  let current = config.urls[0];
  const opened: string[] = []; const gestures: unknown[] = []; const progress: WebQaReport[] = [];
  const controller = new AbortController();
  const deps: HubWebQaDependencies = {
    now: () => clock, random: () => 0.5,
    readAddress: async () => address(current), readPage: async () => page,
    openUrl: async (url) => { opened.push(url); current = url; },
    swipe: async (from, to) => { gestures.push({ from, to }); },
    wait: async (ms) => { clock += ms; },
  };
  return { deps, controller, opened, gestures, progress, publish: (r: WebQaReport) => progress.push(r) };
}

describe("native Hub website QA", () => {
  it("requires a focused Chrome omnibox and rejects other applications", () => {
    expect(readChromeQaAddress(address("example.com/servicios/")).href).toBe(config.urls[1]);
    expect(() => readChromeQaAddress(address("example.com", false))).toThrow();
    expect(() => readChromeQaAddress(address("example.com", true, "other.app"))).toThrow();
    expect(() => readChromeQaAddress(address("http://example.com"))).toThrow();
  });
  it("requires a visible web content area", () => {
    expect(qaScrollArea(page).top).toBe(150);
    expect(() => qaScrollArea('<hierarchy><node class="android.widget.EditText" bounds="[0,0][720,1400]" /></hierarchy>')).toThrow();
  });
  it("runs through mobile commands and ends at the preset deadline", async () => {
    const t = fixture(); const report = await runHubWebQa(config, id, t.deps, t.controller.signal, t.publish);
    expect(report.status).toBe("completed"); expect(t.gestures.length).toBeGreaterThan(0);
    expect(t.opened).toEqual([`https://example.com/?nv_test=${id}`]);
    expect(report.events.at(-1)?.action).toBe("finish");
    expect(report.finishedAt! - report.startedAt).toBeGreaterThanOrEqual(30000);
  });
  it("does not open or scroll Google or an unexpected website", async () => {
    const t = fixture(); t.deps.readAddress = async () => address("https://www.google.com/search?q=test");
    const report = await runHubWebQa(config, id, t.deps, t.controller.signal, t.publish);
    expect(report.status).toBe("failed"); expect(t.opened).toEqual([]); expect(t.gestures).toEqual([]);
  });
  it("stops on external redirects before sending gestures", async () => {
    const t = fixture(); let reads = 0;
    t.deps.readAddress = async () => address(++reads === 1 ? config.urls[0] : "https://external.example/");
    const report = await runHubWebQa(config, id, t.deps, t.controller.signal, t.publish);
    expect(report.status).toBe("failed"); expect(t.gestures).toEqual([]); expect(t.opened).toHaveLength(1);
  });
  it("visits only configured routes, not inferred page links", async () => {
    const t = fixture(); t.deps.random = () => 0;
    const report = await runHubWebQa(config, id, t.deps, t.controller.signal, t.publish);
    expect(report.status).toBe("completed");
    expect(t.opened.every((u) => config.urls.includes(u.split("?")[0]))).toBe(true);
    expect(t.opened.some((u) => u.includes("/servicios/"))).toBe(true);
  });
  it("cancels before startup without executing device commands", async () => {
    const t = fixture(); t.controller.abort();
    const report = await runHubWebQa(config, id, t.deps, t.controller.signal, t.publish);
    expect(report.status).toBe("stopped"); expect(t.opened).toEqual([]); expect(t.gestures).toEqual([]);
  });
  it("does not send gestures after cancellation during a read", async () => {
    const t = fixture(); t.deps.readPage = async () => { t.controller.abort(); return page; };
    const report = await runHubWebQa(config, id, t.deps, t.controller.signal, t.publish);
    expect(report.status).toBe("stopped"); expect(t.gestures).toEqual([]);
  });
  it("stops even if an accessibility read does not respond", async () => {
    const t = fixture(); t.deps.readAddress = () => new Promise(() => {});
    const pending = runHubWebQa(config, id, t.deps, t.controller.signal, t.publish);
    t.controller.abort();
    expect((await pending).status).toBe("stopped"); expect(t.opened).toEqual([]);
  });
});
