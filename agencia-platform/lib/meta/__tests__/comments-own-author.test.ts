import { describe, expect, it } from "vitest";
import { isOwnMetaComment } from "../comments";

const pages = {
  facebookAuthorIds: new Set(["page-123"]),
  instagramUsernames: new Set(["negociovivo"])
};

describe("isOwnMetaComment", () => {
  it("excludes comments published by an authorized Facebook page", () => {
    expect(isOwnMetaComment({ platform: "facebook", from: { id: "page-123", name: "Negocio Vivo" } }, pages)).toBe(true);
    expect(isOwnMetaComment({ platform: "facebook", from: { id: "customer-1", name: "Cliente" } }, pages)).toBe(false);
  });

  it("uses the publication owner even when the page list is incomplete", () => {
    expect(isOwnMetaComment({ platform: "facebook", from: { id: "page-missing" } }, pages, "page-missing")).toBe(true);
  });

  it("excludes comments published by the connected Instagram business account", () => {
    expect(isOwnMetaComment({ platform: "instagram", from: { name: "NEGOCIOVIVO" } }, pages)).toBe(true);
    expect(isOwnMetaComment({ platform: "instagram", from: { name: "cliente" } }, pages)).toBe(false);
  });
});
