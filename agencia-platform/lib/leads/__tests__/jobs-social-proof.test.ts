import { describe, expect, it } from "vitest";
import { ensureJobsSocialProof } from "../exec-outreach";

describe("ensureJobsSocialProof", () => {
  it("añade las cuatro referencias a un borrador en español", () => {
    const body = ensureJobsSocialProof("Hola, hemos visto su vacante.", "es");
    expect(body).toContain("Eroski");
    expect(body).toContain("Vegalsa");
    expect(body).toContain("Caprabo");
    expect(body).toContain("ESAEM");
    expect(body).toContain("Antonio Banderas");
  });

  it("usa una redacción inglesa cuando la oferta está en inglés", () => {
    const body = ensureJobsSocialProof("Hello, we saw your vacancy.", "en");
    expect(body).toContain("We already manage marketing");
    expect(body).toContain("Antonio Banderas' School of Dramatic Arts");
  });

  it("no duplica la prueba social si ya contiene las cuatro marcas", () => {
    const original = "Trabajamos con Eroski, Vegalsa, Caprabo y ESAEM.";
    expect(ensureJobsSocialProof(original, "es")).toBe(original);
  });
});
