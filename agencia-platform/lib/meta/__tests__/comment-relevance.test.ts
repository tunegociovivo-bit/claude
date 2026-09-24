import { describe, expect, it } from "vitest";
import { isIrrelevantMetaComment } from "../comment-relevance";

describe("Meta comment relevance", () => {
  it("marks pure mentions and isolated filler words as irrelevant", () => {
    expect(isIrrelevantMetaComment("@pinchiflinky")).toBe(true);
    expect(isIrrelevantMetaComment("@ana @pepe")).toBe(true);
    expect(isIrrelevantMetaComment("Aceitunas")).toBe(true);
  });

  it("marks short off-topic olive comments as irrelevant", () => {
    expect(isIrrelevantMetaComment("Las aceitunas? Pero siempre serán un buen acompañamiento 😊")).toBe(true);
  });

  it("keeps business questions and complaints as relevant", () => {
    expect(isIrrelevantMetaComment("Cuánto cuesta abrir una franquicia?")).toBe(false);
    expect(isIrrelevantMetaComment("Sigo esperando respuesta de los correos")).toBe(false);
  });
});
