import { describe, expect, it } from "vitest";
import { rankFranchiseDecisionMakers } from "../franchise-decision-maker";

describe("rankFranchiseDecisionMakers", () => {
  it("prioriza a una directora de marketing con email corporativo verificado", () => {
    const [best] = rankFranchiseDecisionMakers([{ email: "ana@marca.es", name: "Ana Ruiz", role: "Directora de Marketing", providerConfidence: 95 }], "marca.es");
    expect(best.confidence).toBe("high");
    expect(best.sendAllowed).toBe(true);
  });

  it("bloquea buzones genéricos aunque pertenezcan al dominio", () => {
    const [best] = rankFranchiseDecisionMakers([{ email: "franquicias@marca.es", role: "Expansión" }], "marca.es");
    expect(best.sendAllowed).toBe(false);
  });

  it("penaliza privacidad, soporte y dominios ajenos", () => {
    const ranked = rankFranchiseDecisionMakers([
      { email: "privacy@marca.es", name: "Equipo legal", role: "Legal" },
      { email: "ana@agencia-externa.es", name: "Ana", role: "Marketing Manager" }
    ], "marca.es");
    expect(ranked.every((candidate) => !candidate.sendAllowed)).toBe(true);
  });
});
