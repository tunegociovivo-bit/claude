import { describe, expect, it } from "vitest";
import { renderProspectingTemplate } from "../prospecting-engine";

describe("renderProspectingTemplate", () => {
  it("personaliza únicamente los campos permitidos", () => {
    expect(renderProspectingTemplate("Hola {{ firstName }}, idea para {{companyName}}", { firstName: "Ana", companyName: "Acme" }))
      .toBe("Hola Ana, idea para Acme");
  });

  it("deja vacío un dato ausente y conserva tokens desconocidos", () => {
    expect(renderProspectingTemplate("{{firstName}} {{unknown}} {{jobTitle}}", { firstName: "Luis" }))
      .toBe("Luis {{unknown}} ");
  });
});
