import { describe, expect, it } from "vitest";
import { buildNegativeCommentEmail } from "../negative-comment-email";

describe("buildNegativeCommentEmail", () => {
  it("incluye contexto y enlace de revisión", () => {
    const result = buildNegativeCommentEmail({ clientName: "ESAEM", campaignName: "Grado", author: "Ana", message: "No me gusta", url: "https://hub.negociovivo.app/admin/meta-comments?comment=abc" });
    expect(result.subject).toContain("ESAEM");
    expect(result.html).toContain("Revisar, responder o eliminar");
    expect(result.text).toContain("comment=abc");
  });

  it("escapa contenido de Meta antes de insertarlo en HTML", () => {
    const result = buildNegativeCommentEmail({ clientName: "<b>Cliente</b>", author: "Atacante", message: '<img src=x onerror="alert(1)">', url: "https://hub.negociovivo.app" });
    expect(result.html).not.toContain("<img");
    expect(result.html).toContain("&lt;img");
    expect(result.html).not.toContain("<b>Cliente</b>");
  });
});
