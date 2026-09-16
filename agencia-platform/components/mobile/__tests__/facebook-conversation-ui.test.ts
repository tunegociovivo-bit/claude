import { describe, expect, it } from "vitest";
import { findExactComment, joinedGroupRows, visibleComments, visiblePostComments } from "@/components/mobile/facebook-conversation-ui";

const node = (text: string, kind: string, bounds: string, desc = "") => `<node package="com.facebook.katana" class="android.widget.${kind}" text="${text}" content-desc="${desc}" bounds="${bounds}" />`;
export const commentScreen = `<hierarchy>
${node("", "ImageView", "[33,843][143,953]", "Foto de perfil de Ana")}
${node("Ana", "Button", "[154,838][394,899]")}
${node("¿Qué franquicia de supermercado recomiendas?", "TextView", "[165,920][900,1030]")}
${node("Responder al comentario de Ana, botón. Toca dos veces para responder al comentario.", "Button", "[143,1050][349,1133]")}
</hierarchy>`;

describe("native Facebook conversation matching", () => {
  it("extracts the comment body and binds its exact reply control", () => {
    expect(visibleComments(commentScreen)).toEqual([expect.objectContaining({ author: "Ana", text: "¿Qué franquicia de supermercado recomiendas?", point: { x: 246, y: 1092 } })]);
  });
  it("does not target another author's identical text", () => {
    expect(findExactComment(commentScreen, "Pedro", "¿Qué franquicia de supermercado recomiendas?")).toBeNull();
  });
  it("refuses ambiguous duplicate comments", () => {
    expect(findExactComment(commentScreen + commentScreen, "Ana", "¿Qué franquicia de supermercado recomiendas?")).toBeNull();
  });
  it("does not treat the author, metadata or GIF description as text to answer", () => {
    const gif = commentScreen.replace("¿Qué franquicia de supermercado recomiendas?", "El GIF Cheers Thumbs Up GIF by VadooTV");
    expect(visibleComments(gif)).toEqual([]);
  });
  it("decodes Android numeric XML entities", () => {
    expect(visibleComments(commentScreen.replace("recomiendas?", "recomiendas?&#10;Gracias&#128077;"))[0].text).toContain("\nGracias👍");
  });
  it("reads joined group names without selecting pin controls", () => {
    const xml = '<node package="com.facebook.katana" class="android.view.ViewGroup" text="Franquicias Más Rentables" bounds="[176,1375][949,1420]" />' + node("", "Button", "[954,1358][1075,1479]", "Fijar grupo");
    expect(joinedGroupRows(xml)).toEqual([{ name: "Franquicias Más Rentables", details: "", point: { x: 563, y: 1398 } }]);
  });
  it("only opens a comments counter with a readable post anchor", () => {
    const xml = node("Una pregunta sobre abrir un supermercado de franquicia", "TextView", "[30,700][1000,900]") + node("12 comentarios", "Button", "[600,920][1000,1000]");
    expect(visiblePostComments(xml)[0].anchor).toContain("supermercado");
    expect(visiblePostComments(xml.replace("12 comentarios", "Comentar"))).toEqual([]);
    expect(visiblePostComments(xml.replace("12 comentarios", "0 comentarios"))).toEqual([]);
    expect(visiblePostComments(node("Comentar", "Button", "[600,920][1000,1000]"))).toEqual([]);
  });
});
