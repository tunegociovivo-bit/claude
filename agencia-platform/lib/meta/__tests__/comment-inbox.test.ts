import { describe, expect, it } from "vitest";
import { campaignOptionsForClient, facebookCommentUrl, filterMetaCommentInbox, matchesMetaCommentSearch } from "../comment-inbox";

const comments = [
  { id: "1", status: "pending", sentiment: "negative", feed: { clientName: "ESAEM Nueva", displayName: "ESAEM", campaignId: "c1", campaignName: "Grado" } },
  { id: "2", status: "pending", sentiment: "neutral", feed: { clientName: "ESAEM Nueva", displayName: "ESAEM", campaignId: "c2", campaignName: "Máster" } },
  { id: "3", status: "replied", sentiment: "positive", feed: { clientName: "Eroski", displayName: null, campaignId: "c3", campaignName: "Franquicias" } }
];

describe("Meta comments inbox filters", () => {
  const history = ["deleted", "hidden", "ignored_self"].map((status) => ({ ...comments[0], id: status, status }));
  it("keeps deleted, hidden and replied comments in history only", () => {
    expect(filterMetaCommentInbox([...comments, ...history], { client: "all", campaign: "all", status: "history" }).map(x => x.id)).toEqual(["3", "deleted", "hidden"]);
    for (const status of ["pending", "negative", "all"]) {
      expect(filterMetaCommentInbox(history, { client: "all", campaign: "all", status })).toEqual([]);
    }
  });
  it("combina cliente, campaña y estado sin mezclar campañas del mismo cliente", () => {
    expect(filterMetaCommentInbox(comments, { client: "esaem", campaign: "c2", status: "pending" }).map((item) => item.id)).toEqual(["2"]);
  });

  it("ofrece solo las campañas del cliente elegido y conserva sus nombres", () => {
    expect(campaignOptionsForClient(comments, "esaem")).toEqual([
      ["c1", "Grado"],
      ["c2", "Máster"]
    ]);
  });

  it("mantiene los filtros negativos y respondidos existentes", () => {
    expect(filterMetaCommentInbox(comments, { client: "all", campaign: "all", status: "negative" }).map((item) => item.id)).toEqual(["1"]);
    expect(filterMetaCommentInbox(comments, { client: "all", campaign: "all", status: "replied" }).map((item) => item.id)).toEqual(["3"]);
  });
});

describe("búsqueda y enlaces de comentarios", () => {
  const item = { message: "Buenos días, traspaso un puesto en el Mercado de La Laguna", authorName: null, adName: "Anuncio dinámico", feed: { clientName: "Eroski", displayName: null, adAccountName: "EROSKI FRANQUICIAS", campaignId: "1", campaignName: "CAMPAÑA CONVERSIÓN EROSKI 2025" } };

  it("busca sin tildes ni mayúsculas en texto, campaña y cliente, con varias palabras", () => {
    expect(matchesMetaCommentSearch(item, "mercado laguna")).toBe(true);
    expect(matchesMetaCommentSearch(item, "conversion eroski")).toBe(true);
    expect(matchesMetaCommentSearch(item, "  ")).toBe(true);
    expect(matchesMetaCommentSearch(item, "laguna madrid")).toBe(false);
  });

  it("enlaza el comentario de Facebook dentro de su publicación", () => {
    expect(facebookCommentUrl("132591756789822_1471314964191449", "1471314964191449_812345678901234")).toBe("https://www.facebook.com/132591756789822_1471314964191449?comment_id=812345678901234");
    expect(facebookCommentUrl("18012345678901234", "18012345678901234")).toBeNull();
    expect(facebookCommentUrl(null, "1_2")).toBeNull();
  });
});
