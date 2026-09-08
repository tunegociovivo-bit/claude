import { describe, expect, it, vi } from "vitest";
import { runWithConcurrency } from "@/lib/meta/bulk-moderation";

describe("moderacion multiple de Meta", () => {
  it("procesa todos los elementos con concurrencia limitada e informa del progreso", async () => {
    let active = 0;
    let peak = 0;
    const progress = vi.fn();
    const result = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return item * 2;
    }, progress);

    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });
});
