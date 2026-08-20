import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    bubuiCustomer: {
      findUnique: vi.fn(async () => ({ apiToken: "secret", plan: "free", planExpiresAt: null })),
      update: vi.fn(() => Promise.resolve({}))
    },
    bubuiSetting: { findUnique: vi.fn(async () => null) },
    bubuiOffer: { findMany: vi.fn(async () => []) }
  }
}));

import { GET } from "@/app/api/bubui/offers/route";

describe("GET /api/bubui/offers cache policy", () => {
  it("never allows a pre-referral empty response to be reused", async () => {
    const response = await GET(new Request("https://bubui.app/api/bubui/offers?customerId=customer-1", {
      headers: { authorization: "Bearer customer-1:secret" }
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });
});
