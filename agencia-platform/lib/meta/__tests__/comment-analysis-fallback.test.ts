import { describe, expect, it, vi } from "vitest";
import { fallbackMetaCommentAnalysis, runMetaCommentAnalysisPipeline } from "@/lib/meta/comment-analysis-fallback";

describe("Meta comment analysis fallback", () => {
  const comments = [{ id: "c1", message: "Esto es una estafa, no funciona" }];

  it("uses the secondary AI when Anthropic billing fails", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("Your credit balance is too low"));
    const secondary = vi.fn().mockResolvedValue([{ id: "c1", sentiment: "negative", reason: "Queja", draft: "Lo sentimos." }]);

    const result = await runMetaCommentAnalysisPipeline(comments, primary, secondary);

    expect(secondary).toHaveBeenCalledOnce();
    expect(result[0].sentiment).toBe("negative");
  });

  it("imports with a safe local analysis when every AI provider fails", async () => {
    const result = await runMetaCommentAnalysisPipeline(
      comments,
      async () => { throw new Error("Anthropic unavailable"); },
      async () => { throw new Error("OpenAI unavailable"); }
    );

    expect(result).toEqual([fallbackMetaCommentAnalysis(comments[0])]);
    expect(result[0].draft).toContain("privado");
  });

  it("creates a neutral safe draft without inventing information", () => {
    expect(fallbackMetaCommentAnalysis({ id: "c2", message: "¿Dónde puedo pedir información?" })).toMatchObject({
      id: "c2",
      sentiment: "neutral",
      draft: "Gracias por tu comentario. ¿Podemos ayudarte por mensaje privado?"
    });
  });

  it("rejects malformed AI fields instead of letting persistence crash", async () => {
    const result = await runMetaCommentAnalysisPipeline(
      comments,
      async () => [{ id: "c1", sentiment: "negative", reason: 42, draft: "Lo sentimos" } as any],
      async () => { throw new Error("secondary unavailable"); }
    );
    expect(result).toEqual([fallbackMetaCommentAnalysis(comments[0])]);
  });

  it.each([
    "Muy mal servicio",
    "No lo recomiendo",
    "Estoy decepcionado",
    "No contestáis nunca",
    "Quiero una devolución",
    "Me cobraron de más"
  ])("flags common reputation complaints during local fallback: %s", (message) => {
    expect(fallbackMetaCommentAnalysis({ id: "negative", message }).sentiment).toBe("negative");
  });
});
