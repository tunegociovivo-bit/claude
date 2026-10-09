import { describe, expect, it } from "vitest";
import { cleanReviewText, reviewerFirstName } from "../gmb-hub";

describe("texto de reseñas", () => {
  it("se queda con el original cuando Google añade la traducción", () => {
    expect(cleanReviewText("(Translated by Google) Fantastic.\n\n(Original)\nExperiencia fantástica.")).toBe("Experiencia fantástica.");
    expect(cleanReviewText("(Traducido por Google) Great")).toBe("Great");
    expect(cleanReviewText("Todo genial")).toBe("Todo genial");
  });
  it("extrae el nombre de pila del autor", () => {
    expect(reviewerFirstName("Ana Parra")).toBe("Ana");
    expect(reviewerFirstName("MARÍA josé")).toBe("María");
    expect(reviewerFirstName("A Google User")).toBe("");
    expect(reviewerFirstName("")).toBe("");
  });
});
