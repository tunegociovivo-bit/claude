import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "1.0.6", android: { versionCode: 1050 }, extra: { apiBaseUrl: "https://bubui.app" } } }
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { buildOffersUrl } from "../api";

describe("offers request cache isolation", () => {
  it("uses a different URL for each feed refresh", () => {
    const first = buildOffersUrl("customer-1", undefined, undefined, 1000);
    const second = buildOffersUrl("customer-1", undefined, undefined, 1001);

    expect(first).not.toBe(second);
    expect(new URL(first).searchParams.get("_refresh")).toBe("1000");
    expect(new URL(second).searchParams.get("_refresh")).toBe("1001");
  });
});
