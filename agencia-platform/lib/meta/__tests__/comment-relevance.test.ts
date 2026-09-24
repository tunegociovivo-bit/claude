import { describe, expect, it } from "vitest";
import { isIrrelevantMetaComment, prepareMetaCommentReplyDraft, sanitizeMetaCommentDraft } from "../comment-relevance";

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

  it("removes internal no-reply explanations from drafts", () => {
    expect(sanitizeMetaCommentDraft("No se responderá a este comentario ya que carece de sentido coherente y no se relaciona con el anuncio de franquicia Eroski.")).toBe("");
    expect(sanitizeMetaCommentDraft("No hay comentario que responder.")).toBe("");
    expect(sanitizeMetaCommentDraft("Hola, gracias por tu interés.")).toBe("Hola, gracias por tu interés.");
  });

  it("replaces generic username placeholders before publishing", () => {
    expect(prepareMetaCommentReplyDraft("@nombredeusuario Gracias por escribirnos.", "_bxn.chnn_")).toBe("@_bxn.chnn_ Gracias por escribirnos.");
    expect(prepareMetaCommentReplyDraft("@nombredeusuario Gracias por escribirnos.", null)).toBe("Gracias por escribirnos.");
  });
});
