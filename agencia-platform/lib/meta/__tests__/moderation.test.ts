import { describe, expect, it } from "vitest";
import { assertMetaDeletionConfirmed, metaDeletionObjectIds } from "@/lib/meta/comments";

describe("confirmacion de borrado de comentarios en Meta", () => {
  it("acepta exclusivamente la confirmacion explicita de Meta", () => {
    expect(() => assertMetaDeletionConfirmed({ success: true })).not.toThrow();
  });

  it.each([{}, { success: false }, null, true])("rechaza una respuesta ambigua: %j", (response) => {
    expect(() => assertMetaDeletionConfirmed(response)).toThrow(/no confirmó/i);
  });

  it("prueba también el id final de comentarios compuestos de Facebook", () => {
    expect(metaDeletionObjectIds("1074487091370042_1234378315234491", "facebook")).toEqual([
      "1074487091370042_1234378315234491",
      "1234378315234491"
    ]);
    expect(metaDeletionObjectIds("17890000000001", "instagram")).toEqual(["17890000000001"]);
  });
});
