import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/integrations/gmb", () => ({ gmbReplyReview: vi.fn(), gbpSourceForClient: vi.fn(), gmbLocationPath: vi.fn() }));
vi.mock("@/lib/integrations/gmb-hub", () => ({ createGmbNotification: vi.fn(), generateReviewReply: vi.fn(), getGmbConfig: vi.fn(), logGmbActivity: vi.fn(), sendTelegram: vi.fn() }));
import { modeMatches, normalizeNotifyMode, normalizeReplyMode } from "@/lib/gmb/review-automation";

describe("review automation modes", () => {
  it("positivas 4-5, negativas 1-3", () => {
    expect(modeMatches("positive", 5)).toBe(true);
    expect(modeMatches("positive", 4)).toBe(true);
    expect(modeMatches("positive", 3)).toBe(false);
    expect(modeMatches("negative", 3)).toBe(true);
    expect(modeMatches("negative", 1)).toBe(true);
    expect(modeMatches("negative", 4)).toBe(false);
    expect(modeMatches("both", 2)).toBe(true);
    expect(modeMatches("manual", 5)).toBe(false);
    expect(modeMatches("none", 1)).toBe(false);
  });
  it("normaliza valores antiguos o vacíos", () => {
    expect(normalizeReplyMode("auto")).toBe("positive");
    expect(normalizeReplyMode("")).toBe("manual");
    expect(normalizeReplyMode("both")).toBe("both");
    expect(normalizeNotifyMode(undefined)).toBe("negative");
    expect(normalizeNotifyMode("none")).toBe("none");
  });
});
