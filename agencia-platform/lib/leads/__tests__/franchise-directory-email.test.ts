import { describe, expect, it } from "vitest";
import { extractFichaEmails, removeEscapedNewlineEmailArtifacts } from "../sources/franchise-directory";

describe("franchise directory email extraction", () => {
  it("no convierte la n de un salto de línea escapado en parte del correo", () => {
    expect(extractFichaEmails(String.raw`Contacto:\ninteresados@nacex.com`)).toEqual(["interesados@nacex.com"]);
  });

  it("elimina candidatos históricos con n o r pegada cuando existe el correo correcto", () => {
    expect(removeEscapedNewlineEmailArtifacts(["interesados@nacex.com", "ninteresados@nacex.com", "rinteresados@nacex.com"])).toEqual(["interesados@nacex.com"]);
  });
});
