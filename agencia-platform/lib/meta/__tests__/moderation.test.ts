import { describe, expect, it } from "vitest";
import { assertMetaDeletionConfirmed } from "@/lib/meta/comments";

describe("confirmacion de borrado de comentarios en Meta", () => {
  it("acepta exclusivamente la confirmacion explicita de Meta", () => {
    expect(() => assertMetaDeletionConfirmed({ success: true })).not.toThrow();
  });

  it.each([{}, { success: false }, null, true])("rechaza una respuesta ambigua: %j", (response) => {
    expect(() => assertMetaDeletionConfirmed(response)).toThrow(/no confirmó/i);
  });
});
