import { describe, expect, it } from "vitest";
import { bulkDeleteTransition } from "@/lib/meta/bulk-delete-flow";

describe("confirmacion integrada del borrado multiple", () => {
  it("solicita confirmacion en el primer toque sin depender de window.confirm", () => {
    expect(bulkDeleteTransition("idle", "request")).toBe("confirming");
  });

  it("solo comienza tras confirmar y permite cancelar", () => {
    expect(bulkDeleteTransition("confirming", "confirm")).toBe("running");
    expect(bulkDeleteTransition("confirming", "cancel")).toBe("idle");
  });
});
