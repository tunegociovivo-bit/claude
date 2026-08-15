import { describe, expect, it } from "vitest";
import { isRelevantCompetitor } from "../competitors";

const poolLead = {
  placeId: "pool-1",
  name: "Piscinas Grupo Andreu",
  category: "Piscinas y mantenimiento",
  types: ["swimming_pool_contractor", "store", "point_of_interest", "establishment"]
};

describe("competitor relevance guard", () => {
  it("rechaza un negocio de masajes eróticos para un lead de piscinas", () => {
    expect(isRelevantCompetitor(poolLead, {
      placeId: "massage-1",
      name: "Masajes eróticos Alicante Eternal Massage Erotic Massage",
      category: "Masajista",
      types: ["massage_spa", "spa", "point_of_interest", "establishment"]
    } as any)).toBe(false);
  });

  it("acepta otra empresa de piscinas aunque comparta tipos genéricos", () => {
    expect(isRelevantCompetitor(poolLead, {
      placeId: "pool-2",
      name: "Piscinas Costa Blanca",
      category: "Contratista de piscinas",
      types: ["swimming_pool_contractor", "store", "point_of_interest", "establishment"]
    } as any)).toBe(true);
  });

  it("si no hay tipos fiables exige coincidencia sectorial léxica", () => {
    expect(isRelevantCompetitor({ ...poolLead, types: [] }, {
      placeId: "reform-1",
      name: "Reformas Alicante",
      category: "Empresa constructora",
      types: ["general_contractor", "establishment"]
    } as any)).toBe(false);
  });

  it("siempre conserva la ficha exacta del lead para calcular su posición", () => {
    expect(isRelevantCompetitor(poolLead, { ...poolLead } as any)).toBe(true);
  });
});
