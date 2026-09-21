import { describe, expect, it } from "vitest";
import { generateDraftBatches } from "../draft-batches";

describe("draft batch generation", () => {
  it("processes more than 50 selections exactly once in small requests", async () => {
    const ids = Array.from({ length: 123 }, (_, i) => String(i));
    const requests: string[][] = [];
    const generated: Record<string, string> = {};
    const result = await generateDraftBatches([...ids, ids[0]], async (batch) => {
      requests.push(batch);
      return { drafts: Object.fromEntries(batch.map((id) => [id, `draft ${id}`])) };
    }, (drafts) => Object.assign(generated, drafts));
    expect(requests.flat()).toEqual(ids);
    expect(requests.every((batch) => batch.length <= 5)).toBe(true);
    expect(Object.keys(generated)).toHaveLength(123);
    expect(result.failedIds).toEqual([]);
  });

  it("preserves success and keeps missing or failed drafts available to retry", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => String(i));
    const generated: Record<string, string> = {};
    const result = await generateDraftBatches(ids, async (batch) => {
      if (batch[0] === "5") throw new Error("Service unavailable");
      return { drafts: Object.fromEntries(batch.filter((id) => id !== "1").map((id) => [id, "draft"])) };
    }, (drafts) => Object.assign(generated, drafts));
    expect(result.failedIds).toEqual(["1", "5", "6", "7", "8", "9"]);
    expect(generated["10"]).toBe("draft");
    expect(Object.keys(generated)).toHaveLength(6);
  });
});
