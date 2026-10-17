import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { validateWebQa, webQaLaunchUrl, webQaSearchUrl } from "../web-qa";

const id = "12345678-1234-1234-1234-123456789abc";
const template = { name: "Reva", keyword: "mudanzas malaga", business: "Mudanzas Reva", urls: ["https://example.com/", "https://example.com/servicios/"], seconds: 60 };
const source = readFileSync(new URL("../../../public/nv-web-qa.js", import.meta.url), "utf8");

function harness(options: { href?: string; saved?: unknown; random?: number; links?: string[] } = {}) {
  const href = options.href ?? webQaLaunchUrl(template, id);
  const store = new Map<string, string>(options.saved ? [["nv-web-qa-v1", JSON.stringify(options.saved)]] : []);
  const buttons = new Map<string, () => void>();
  const tasks = new Map<number, { fn: () => void; delay: number }>();
  const assigned: string[] = [];
  const scrolls: unknown[] = [];
  const events = new Map<string, () => void>();
  let serial = 0;
  const element = () => ({ id: "", style: {}, textContent: "", disabled: false, append() {}, setAttribute() {}, attachShadow: () => element(), addEventListener(_type: string, fn: () => void) { buttons.set(this.textContent, fn); } });
  const location = Object.assign(new URL(href), { assign: (value: string) => assigned.push(value) });
  const document = {
    readyState: "complete", hidden: false, body: element(), createElement: element,
    addEventListener: (event: string, fn: () => void) => events.set(event, fn),
    querySelectorAll: () => (options.links || []).map((url) => ({ href: url, target: "", hasAttribute: () => false, closest: () => null, getClientRects: () => [1] })),
  };
  const window: Record<string, unknown> = { innerHeight: 800, scrollY: 0, scrollBy: (value: unknown) => scrolls.push(value), dispatchEvent() {}, addEventListener() {} };
  window.self = window; window.top = window;
  const context = { window, location, document, URL, Blob, history: { replaceState() {} }, sessionStorage: { getItem: (key: string) => store.get(key) || null, setItem: (key: string, value: string) => store.set(key, value) }, CustomEvent: class {}, Date, Math: { ...Math, floor: Math.floor, round: Math.round, max: Math.max, ceil: Math.ceil, random: () => options.random ?? 0.5 }, setTimeout: (fn: () => void, delay: number) => { tasks.set(++serial, { fn, delay }); return serial; }, clearTimeout: (key: number) => tasks.delete(key) };
  vm.runInNewContext(source, context);
  return { window, location, document, buttons, tasks, assigned, scrolls, events, state: () => JSON.parse(store.get("nv-web-qa-v1") || "null"), tick: () => {
    const task = [...tasks.entries()].find(([, value]) => value.delay < 10000);
    if (task) { tasks.delete(task[0]); task[1].fn(); }
  } };
}

describe("web QA configuration", () => {
  it("supports independent website templates and encoded manual searches", () => {
    expect(validateWebQa(template).urls).toHaveLength(2);
    expect(new URL(webQaSearchUrl(template)).searchParams.get("q")).toBe(template.keyword);
    expect(validateWebQa({ ...template, urls: ["https://another.example/"] }).urls[0]).toBe("https://another.example/");
  });
  it.each(["http://example.com/", "https://evil.example/", "https://example.com/?delete=1", "https://example.com/logout", "https://user:pass@example.com/", "https://example.com/%63heckout"]) ("rejects unsafe destination %s", (url) => {
    expect(() => validateWebQa({ ...template, urls: [template.urls[0], url] })).toThrow();
  });
  it("bounds duration and requires explicit destinations", () => {
    expect(() => validateWebQa({ ...template, seconds: 901 })).toThrow();
    expect(() => validateWebQa({ ...template, urls: [] })).toThrow();
  });
});

describe("installed website runner", () => {
  it("is inert for ordinary visitors and requires a manual start", () => {
    expect(harness({ href: "https://example.com/" }).window.nvWebQa).toBeUndefined();
    const test = harness();
    expect(test.state().status).toBe("ready");
    expect(test.tasks.size).toBe(0);
    test.buttons.get("Iniciar prueba")!(); test.tick();
    expect(test.scrolls).toHaveLength(1);
    expect(test.state().events.some((e: { type: string }) => e.type === "scroll-request")).toBe(true);
  });
  it("never follows external, query-action, download or unapproved destinations", () => {
    const test = harness({ random: 0, links: ["https://evil.example/", "https://example.com/?delete=1", "https://example.com/unapproved/"] });
    test.buttons.get("Iniciar prueba")!(); test.tick();
    expect(test.assigned).toEqual([]);
  });
  it("navigates only to exact approved on-page links with a synthetic marker", () => {
    const test = harness({ random: 0, links: [template.urls[1]] });
    test.buttons.get("Iniciar prueba")!(); test.tick();
    expect(test.assigned).toEqual([`${template.urls[1]}?nv_test=${id}`]);
  });
  it("stop cancels all scheduled actions", () => {
    const test = harness(); test.buttons.get("Iniciar prueba")!(); test.buttons.get("Detener")!(); test.tick();
    expect(test.tasks.size).toBe(0); expect(test.scrolls).toEqual([]); expect(test.state().status).toBe("stopped");
  });
  it("pauses background actions and resumes only within the time limit", () => {
    const test = harness(); test.buttons.get("Iniciar prueba")!(); test.document.hidden = true; test.events.get("visibilitychange")!();
    expect([...test.tasks.values()].filter((task) => task.delay < 10000)).toHaveLength(0);
    test.document.hidden = false; test.events.get("visibilitychange")!(); test.tick(); expect(test.scrolls).toHaveLength(1);
  });
  it("rejects tampered and cross-origin configurations without mounting controls", () => {
    const url = new URL(template.urls[0]);
    url.hash = `nv-qa=${encodeURIComponent(JSON.stringify({ v: 1, id, urls: ["https://evil.example/"], seconds: 60 }))}`;
    expect(harness({ href: url.href }).buttons.size).toBe(0);
  });
  it("completes expired sessions without further navigation", () => {
    const test = harness({ href: template.urls[0], saved: { v: 1, id, urls: template.urls, seconds: 60, status: "running", createdAt: Date.now() - 70000, endsAt: Date.now() - 1000, visits: 1, events: [] } });
    expect(test.state().status).toBe("completed"); expect(test.scrolls).toHaveLength(0);
  });
});
