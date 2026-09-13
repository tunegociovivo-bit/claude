import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cache: {
    findUnique: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn()
  },
  dailyUsage: {
    upsert: vi.fn(),
    updateMany: vi.fn()
  },
  transaction: vi.fn(),
  hunterVerifyEmail: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { leadEmailVerificationCache: mocks.cache, leadProviderDailyUsage: mocks.dailyUsage, $transaction: mocks.transaction }
}));

vi.mock("../enrich-contacts", () => ({
  hunterVerifyEmail: mocks.hunterVerifyEmail,
  resolveContactKeys: vi.fn()
}));

import { verifyMailboxCached } from "../email-verification-cache";

describe("GMB mailbox verification cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.updateMany.mockResolvedValue({ count: 1 });
    mocks.cache.update.mockResolvedValue({});
    mocks.dailyUsage.upsert.mockResolvedValue({ id: "usage_1", used: 0 });
    mocks.dailyUsage.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: any) => callback({ leadEmailVerificationCache: mocks.cache, leadProviderDailyUsage: mocks.dailyUsage }));
  });

  it("reuses a fresh deliverable verdict without spending another Hunter call", async () => {
    mocks.cache.findUnique.mockResolvedValue({
      id: "cache_1",
      status: "deliverable",
      expiresAt: new Date(Date.now() + 86_400_000),
      nextVerificationAt: null
    });
    const result = await verifyMailboxCached({ workspaceId: "ws_1", email: "info@empresa.es", hunterKey: "key", dailyLimit: 100, allowProviderCall: true });
    expect(result).toMatchObject({ status: "deliverable", deferred: false, providerCallConsumed: false });
    expect(mocks.hunterVerifyEmail).not.toHaveBeenCalled();
  });

  it("defers without a provider call when the workspace daily budget is exhausted", async () => {
    mocks.cache.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: "cache_1", status: "pending", expiresAt: null, nextVerificationAt: null, leaseUntil: null });
    mocks.dailyUsage.updateMany.mockResolvedValue({ count: 0 });
    mocks.cache.upsert.mockResolvedValue({ id: "cache_1", leaseUntil: null });
    const result = await verifyMailboxCached({ workspaceId: "ws_1", email: "info@empresa.es", hunterKey: "key", dailyLimit: 100, allowProviderCall: true });
    expect(result.status).toBe("domain_mx_valid");
    expect(result.deferred).toBe(true);
    expect(result.providerCallConsumed).toBe(false);
    expect(mocks.hunterVerifyEmail).not.toHaveBeenCalled();
  });

  it("persists a mailbox-level valid verdict and marks the external call as consumed", async () => {
    mocks.cache.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: "cache_1", status: "pending", expiresAt: null, nextVerificationAt: null, leaseUntil: null });
    mocks.cache.upsert.mockResolvedValue({ id: "cache_1", leaseUntil: null });
    mocks.hunterVerifyEmail.mockResolvedValue({ email: "info@empresa.es", status: "valid", score: 100 });
    const result = await verifyMailboxCached({ workspaceId: "ws_1", email: "info@empresa.es", hunterKey: "key", dailyLimit: 100, allowProviderCall: true });
    expect(result).toMatchObject({ status: "deliverable", deferred: false, providerCallConsumed: true });
    expect(mocks.cache.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "deliverable" }) }));
  });

  it("stores a retry checkpoint when Hunter is temporarily unavailable", async () => {
    mocks.cache.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: "cache_1", status: "pending", expiresAt: null, nextVerificationAt: null, leaseUntil: null });
    mocks.cache.upsert.mockResolvedValue({ id: "cache_1", leaseUntil: null });
    mocks.hunterVerifyEmail.mockRejectedValue(new Error("Hunter todavía está verificando"));
    await expect(verifyMailboxCached({ workspaceId: "ws_1", email: "info@empresa.es", hunterKey: "key", dailyLimit: 100, allowProviderCall: true })).rejects.toThrow("todavía");
    expect(mocks.cache.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending", leaseUntil: null }) }));
  });
});
