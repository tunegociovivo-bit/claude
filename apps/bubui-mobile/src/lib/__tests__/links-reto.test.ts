import { describe, it, expect, vi } from "vitest";

vi.mock("react-native", () => ({ Linking: { openURL: vi.fn(() => Promise.resolve()) } }));
vi.mock("../api", () => ({ API_BASE: "https://bubui.app" }));

import { retoTokenFromPath } from "../links";

const TOKEN = "aaac414dd4505807";

describe("retoTokenFromPath", () => {
  it("recognises https app links, paths and the custom scheme", () => {
    expect(retoTokenFromPath(`https://bubui.app/reto/${TOKEN}`)).toBe(TOKEN);
    expect(retoTokenFromPath(`https://www.bubui.app/reto/${TOKEN}?utm=x`)).toBe(TOKEN);
    expect(retoTokenFromPath(`/reto/${TOKEN}`)).toBe(TOKEN);
    expect(retoTokenFromPath(`bubui://reto/${TOKEN}`)).toBe(TOKEN);
  });

  it("does not treat unrelated links as challenges", () => {
    expect(retoTokenFromPath("https://bubui.app/scan/biz123")).toBeNull();
    expect(retoTokenFromPath("/offers")).toBeNull();
    expect(retoTokenFromPath(null)).toBeNull();
  });
});
