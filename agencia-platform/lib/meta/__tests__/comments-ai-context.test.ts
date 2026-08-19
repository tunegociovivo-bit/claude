import { describe, expect, it } from "vitest";
import { buildMetaCommentAnalysisPrompt } from "../comments";

describe("buildMetaCommentAnalysisPrompt", () => {
  it("adds the client's company context to the AI prompt", () => {
    const prompt = buildMetaCommentAnalysisPrompt("ESAEM", [
      { id: "comment-1", message: "¿Desde qué edad puedo matricularme?" }
    ], "Academia de artes escénicas. Matrícula desde los 16 años. Teléfono 952 00 00 00.");

    expect(prompt).toContain("Información verificada de la empresa");
    expect(prompt).toContain("Matrícula desde los 16 años");
    expect(prompt).toContain("¿Desde qué edad puedo matricularme?");
  });

  it("does not invent an empty company context section", () => {
    const prompt = buildMetaCommentAnalysisPrompt("ESAEM", [
      { id: "comment-1", message: "Hola" }
    ], "   ");

    expect(prompt).not.toContain("Información verificada de la empresa");
    expect(prompt).toContain("Cliente: ESAEM");
  });

  it("limits oversized context before sending it to the AI", () => {
    const prompt = buildMetaCommentAnalysisPrompt("Cliente", [], "x".repeat(7000));

    expect(prompt.length).toBeLessThan(6000);
  });
});
