import { afterEach, describe, expect, it, vi } from "vitest";
import { collectJobs } from "../sources/jobs";

const LINKEDIN_HTML = `
  <li>
    <div>
      <a class="base-card__full-link" href="https://es.linkedin.com/jobs/view/123?trackingId=test"></a>
      <h3 class="base-search-card__title">Marketing Manager</h3>
      <h4 class="base-search-card__subtitle">
        <a href="https://www.linkedin.com/company/acme">Acme España</a>
      </h4>
      <span class="job-search-card__location">Madrid, Comunidad de Madrid, España</span>
    </div>
  </li>
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LinkedIn Jobs nacional", () => {
  it("usa primero el endpoint público nacional y no consume Scrapfly si responde", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://www.linkedin.com/jobs-guest/")) {
        return new Response(LINKEDIN_HTML, { status: 200 });
      }
      if (url.startsWith("https://api.scrapfly.io/")) {
        return new Response(JSON.stringify({ message: "no credits" }), {
          status: 402,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await collectJobs({
      keyword: "marketing",
      location: "",
      apiKey: "scrapfly-sin-saldo",
      scope: "spain",
      boards: ["linkedin"]
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "Acme España", province: "Madrid, Comunidad de Madrid, España" });
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes("linkedin.com/jobs-guest/") && url.includes("geoId=105646813"))).toBe(true);
    expect(urls.some((url) => url.startsWith("https://api.scrapfly.io/"))).toBe(false);
  });

  it("recorre cien páginas nacionales para ampliar el potencial hasta mil ofertas", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.startsWith("https://www.linkedin.com/jobs-guest/")) {
        throw new Error(`URL inesperada: ${url}`);
      }
      const start = new URL(url).searchParams.get("start") ?? "0";
      return new Response(LINKEDIN_HTML.replace("Acme España", `Empresa ${start}`), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await collectJobs({
      keyword: "marketing",
      location: "",
      apiKey: "",
      scope: "spain",
      boards: ["linkedin"]
    });

    expect(results).toHaveLength(100);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toHaveLength(100);
    expect(urls.at(-1)).toContain("start=990");
  });

  it("mantiene Scrapfly como respaldo cuando LinkedIn bloquea la petición directa", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://www.linkedin.com/jobs-guest/")) {
        return new Response("blocked", { status: 429 });
      }
      if (url.startsWith("https://api.scrapfly.io/")) {
        return new Response(JSON.stringify({ result: { content: LINKEDIN_HTML } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await collectJobs({
      keyword: "marketing",
      location: "",
      apiKey: "scrapfly-key",
      scope: "spain",
      boards: ["linkedin"]
    });

    expect(results).toHaveLength(1);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.startsWith("https://www.linkedin.com/jobs-guest/"))).toBe(true);
    expect(urls.filter((url) => url.startsWith("https://api.scrapfly.io/"))).toHaveLength(1);
  });
});
