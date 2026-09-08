import { describe, expect, it, vi } from "vitest";
import { formatBulkModerationStatus, runWithConcurrency } from "@/lib/meta/bulk-moderation";

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

  it("muestra un resultado local comprensible aunque Meta rechace parte del lote", () => {
    expect(formatBulkModerationStatus({ action: "delete_comment", completed: 0, total: 10 })).toBe("Eliminando 0/10…");
    expect(formatBulkModerationStatus({ action: "delete_comment", completed: 10, total: 10, failed: 10 })).toBe("Meta no permitió eliminar ninguno de los 10 comentarios. Revisa el motivo mostrado aquí.");
    expect(formatBulkModerationStatus({ action: "delete_comment", completed: 10, total: 10, failed: 3 })).toBe("7 eliminados; 3 no se pudieron eliminar y siguen seleccionados.");
  });
});
