import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gmbGoogleConnection: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  googleAdsConnection: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/ai/crypto", () => ({ decryptSecret: vi.fn(() => "refresh-token") }));

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Google Business Profile account quota protection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    db.gmbGoogleConnection.findUnique.mockResolvedValue({
      refreshTokenEnc: "encrypted",
      revokedAt: null,
    });
    db.gmbGoogleConnection.updateMany.mockResolvedValue({ count: 0 });
  });

  it("deduplicates simultaneous account requests for the same workspace", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "access" });
      return jsonResponse({ accounts: [{ name: "accounts/123", accountName: "Negocio Vivo" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { gmbListAccounts } = await import("../gmb");
    const [first, second] = await Promise.all([gmbListAccounts("ws-1"), gmbListAccounts("ws-1")]);

    expect(first).toEqual(second);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/accounts?pageSize=50"))).toHaveLength(1);
  });

  it("retries a quota response using Retry-After before surfacing an error", async () => {
    let accountAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "access" });
      accountAttempts += 1;
      if (accountAttempts === 1) {
        return jsonResponse(
          { error: { code: 429, message: "Quota exceeded" } },
          429,
          { "retry-after": "0" },
        );
      }
      return jsonResponse({ accounts: [{ name: "accounts/456", accountName: "Cliente" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { gmbListAccounts } = await import("../gmb");
    await expect(gmbListAccounts("ws-2")).resolves.toMatchObject([{ accountId: "456" }]);
    expect(accountAttempts).toBe(2);
  });
});
