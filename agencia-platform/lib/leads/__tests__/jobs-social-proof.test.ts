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

  it("reconoce el nombre completo de ESAEM y no repite las otras marcas", () => {
    const original = "Ya gestionamos el marketing de empresas como Eroski, Vegalsa, Caprabo y la Escuela de Arte Dramático de Antonio Banderas, así que conocemos entornos exigentes.";

    const body = ensureJobsSocialProof(original, "es");

    expect(body.match(/Eroski/gi)).toHaveLength(1);
    expect(body.match(/Vegalsa/gi)).toHaveLength(1);
    expect(body.match(/Caprabo/gi)).toHaveLength(1);
    expect(body.match(/Antonio Banderas/gi)).toHaveLength(1);
    expect(body).toContain("ESAEM");
  });

  it("añade solamente las referencias que faltan cuando la prueba social es parcial", () => {
    const body = ensureJobsSocialProof("Ya gestionamos el marketing de Eroski.", "es");

    expect(body.match(/Eroski/gi)).toHaveLength(1);
    expect(body.match(/Vegalsa/gi)).toHaveLength(1);
    expect(body.match(/Caprabo/gi)).toHaveLength(1);
    expect(body.match(/ESAEM/gi)).toHaveLength(1);
  });

  it("reconoce la descripción inglesa de ESAEM sin duplicar clientes", () => {
    const original = "We manage marketing for Eroski, Vegalsa, Caprabo and Antonio Banderas' School of Dramatic Arts.";

    const body = ensureJobsSocialProof(original, "en");

    expect(body.match(/Eroski/gi)).toHaveLength(1);
    expect(body.match(/Vegalsa/gi)).toHaveLength(1);
    expect(body.match(/Caprabo/gi)).toHaveLength(1);
    expect(body.match(/Antonio Banderas/gi)).toHaveLength(1);
    expect(body).toContain("ESAEM");
  });
});
