import { describe, expect, it } from "vitest";
import {
  buildFranchiseCadence,
  buildFranchisePilot,
  checkFranchiseExclusivity,
  scoreFranchiseOpportunity,
  summarizeFranchiseLearning
} from "../franchise-growth-engine";

describe("franchise growth engine", () => {
  it("prioriza intención reciente y problemas demostrables", () => {
    const result = scoreFranchiseOpportunity({
      signals: [{ type: "new_locations", strength: 90, observedAt: "2026-08-20", evidence: "Abre 8 centros" }],
      auditScore: 72,
      verifiedDecisionMaker: true,
      networkSize: 80
    });
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.tier).toBe("actuar_ahora");
    expect(result.reasons).toContain("Expansión o cambio reciente");
  });

  it("no infla una cuenta sin señales ni decisor", () => {
    const result = scoreFranchiseOpportunity({ signals: [], auditScore: 20, verifiedDecisionMaker: false, networkSize: 5 });
    expect(result.score).toBeLessThan(35);
    expect(result.tier).toBe("observar");
  });

  it("genera un piloto con grupo de intervención y control", () => {
    const pilot = buildFranchisePilot({ brand: "Marca", sampled: 40, auditScore: 68 });
    expect(pilot.interventionLocations).toBeGreaterThanOrEqual(5);
    expect(pilot.controlLocations).toBe(pilot.interventionLocations);
    expect(pilot.durationDays).toBe(60);
    expect(pilot.successMetrics).toContain("visibilidad local");
  });

  it("crea una cadencia multicanal que se detiene al responder", () => {
    const cadence = buildFranchiseCadence("2026-08-25T10:00:00.000Z");
    expect(cadence).toHaveLength(5);
    expect(cadence[0].channel).toBe("email");
    expect(cadence.every((step) => step.stopOnReply)).toBe(true);
    expect(new Date(cadence[4].scheduledAt).getTime()).toBeGreaterThan(new Date(cadence[0].scheduledAt).getTime());
  });

  it("detecta exclusividad sectorial o territorial real", () => {
    const conflict = checkFranchiseExclusivity({ category: "gimnasios", provinces: ["Málaga", "Sevilla"] }, [{ client: "FitCo", category: "gimnasios", provinces: ["Málaga"] }]);
    expect(conflict.allowed).toBe(false);
    expect(conflict.conflicts[0].client).toBe("FitCo");
  });

  it("aprende qué señales y cargos convierten en reuniones", () => {
    const learning = summarizeFranchiseLearning([
      { outcome: "meeting", role: "Directora de Marketing", signalTypes: ["new_locations"] },
      { outcome: "lost", role: "Atención al cliente", signalTypes: ["reviews"] },
      { outcome: "won", role: "Directora de Marketing", signalTypes: ["new_locations"] }
    ]);
    expect(learning.bestRole).toBe("Directora de Marketing");
    expect(learning.bestSignal).toBe("new_locations");
    expect(learning.meetingOrWinRate).toBeCloseTo(66.7, 1);
  });
});
