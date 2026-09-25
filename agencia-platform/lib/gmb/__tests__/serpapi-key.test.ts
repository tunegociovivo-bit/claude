import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
import { cleanSerpApiKey, looksLikeSerpApiKey, maskKey } from "@/lib/integrations/serpapi";
describe("serpapi key", () => {
  it("limpia y valida", () => {
    const k = "a".repeat(60) + "b1c2";
    expect(cleanSerpApiKey(` "${k}"\n`)).toBe(k);
    expect(cleanSerpApiKey(`https://serpapi.com/search.json?engine=x&api_key=${k}&q=1`)).toBe(k);
    expect(cleanSerpApiKey("​" + k + " ")).toBe(k);
    expect(looksLikeSerpApiKey(k)).toBe(true);
    expect(looksLikeSerpApiKey(k + "x")).toBe(false);
    expect(maskKey(k)).toBe("64 caracteres, termina en …b1c2");
  });
});
