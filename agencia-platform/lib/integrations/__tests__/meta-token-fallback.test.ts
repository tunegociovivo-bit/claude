import { describe, expect, it, vi } from "vitest";

import { tryMetaTokenCandidates } from "@/lib/integrations/meta-token-fallback";

describe("tryMetaTokenCandidates", () => {
  it("uses another workspace connection when the task token cannot access the campaign", async () => {
    const request = vi.fn(async (token: string) => {
      if (token === "task-token-without-access") {
        throw new Error(
          "Meta Ads 400: Unsupported get request. Object does not exist or is missing permissions"
        );
      }
      return { campaignId: "120210470402160107", tokenUsed: token };
    });

    const result = await tryMetaTokenCandidates(
      ["task-token-without-access", "workspace-token-with-access"],
      request
    );

    expect(result).toEqual({
      campaignId: "120210470402160107",
      tokenUsed: "workspace-token-with-access"
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("deduplicates credentials so the same invalid token is not retried", async () => {
    const request = vi.fn(async (token: string) => {
      if (token === "invalid") throw new Error("Meta Ads 400: missing permissions");
      return token;
    });

    await expect(
      tryMetaTokenCandidates(["invalid", "invalid", "valid"], request)
    ).resolves.toBe("valid");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not hide a non-credential error by rotating tokens", async () => {
    const request = vi.fn(async () => {
      throw new Error("Meta Ads 429: rate limit");
    });

    await expect(
      tryMetaTokenCandidates(["first", "second"], request)
    ).rejects.toThrow("rate limit");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
