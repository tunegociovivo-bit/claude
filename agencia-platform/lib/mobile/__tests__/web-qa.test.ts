import { describe, expect, it } from "vitest";
import { validateWebQa, validatedWebQaSchema, webQaLaunchUrl, webQaReportSchema, webQaSearchUrl } from "../web-qa";

const id = "12345678-1234-1234-1234-123456789abc";
const template = { name: "Reva", keyword: "mudanzas malaga", business: "Mudanzas Reva", urls: ["https://example.com/", "https://example.com/servicios/"], seconds: 60 };

describe("web QA configuration", () => {
  it("supports independent website templates and encoded manual searches", () => {
    expect(validateWebQa(template).urls).toHaveLength(2);
    expect(new URL(webQaSearchUrl(template)).searchParams.get("q")).toBe(template.keyword);
    expect(validateWebQa({ ...template, urls: ["https://another.example/"] }).urls[0]).toBe("https://another.example/");
  });
  it.each(["http://example.com/", "https://evil.example/", "https://example.com/?delete=1", "https://example.com/logout", "https://user:pass@example.com/", "https://example.com/%63heckout"]) ("rejects unsafe destination %s", (url) => {
    expect(() => validateWebQa({ ...template, urls: [template.urls[0], url] })).toThrow();
    expect(validatedWebQaSchema.safeParse({ ...template, urls: [template.urls[0], url] }).success).toBe(false);
  });
  it("bounds duration and requires explicit destinations", () => {
    expect(() => validateWebQa({ ...template, seconds: 901 })).toThrow();
    expect(() => validateWebQa({ ...template, urls: [] })).toThrow();
  });
  it("launches a tagged page without embedding a script or configuration", () => {
    const url = new URL(webQaLaunchUrl(template, id, 1));
    expect(url.hash).toBe(""); expect(url.searchParams.get("nv_test")).toBe(id);
    expect(url.pathname).toBe("/servicios/"); expect(url.searchParams.has("urls")).toBe(false);
  });
  it("rejects oversized or malformed station reports", () => {
    expect(webQaReportSchema.safeParse({ id, status: "running", seconds: 60, startedAt: 1, events: [] }).success).toBe(true);
    expect(webQaReportSchema.safeParse({ id, status: "running", seconds: 60, startedAt: 1, events: Array(201).fill({ at: 1, action: "scroll" }) }).success).toBe(false);
  });
});
