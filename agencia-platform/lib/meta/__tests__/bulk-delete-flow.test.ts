import { describe, expect, it } from "vitest";
import { bulkDeleteTransition } from "@/lib/meta/bulk-delete-flow";

describe("confirmacion integrada del borrado multiple", () => {
  it("solicita confirmacion en el primer toque sin depender de window.confirm", () => {
    expect(bulkDeleteTransition({ phase: "idle", ids: [] }, { type: "request", ids: ["a", "b"] })).toEqual({ phase: "confirming", ids: ["a", "b"] });
  });

  it("conserva el lote confirmado y no permite confirmar dos veces", () => {
    const confirming = { phase: "confirming" as const, ids: ["a", "b"] };
    const running = bulkDeleteTransition(confirming, { type: "confirm" });
    expect(running).toEqual({ phase: "running", ids: ["a", "b"] });
    expect(bulkDeleteTransition(running, { type: "confirm" })).toBe(running);
  });

  it("invalida el lote al cancelar o cambiar la seleccion", () => {
    const confirming = { phase: "confirming" as const, ids: ["a"] };
    expect(bulkDeleteTransition(confirming, { type: "cancel" })).toEqual({ phase: "idle", ids: [] });
  });
});
