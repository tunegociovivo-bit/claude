import { describe, expect, it } from "vitest";
import { findOwnMetaReply, isOwnMetaComment } from "../comments";

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

  it("detects a Facebook page reply nested under a customer comment", () => {
    const reply = findOwnMetaReply({ comments: { data: [
      { id: "customer-reply", from: { id: "customer-1" }, created_time: "2026-08-19T08:00:00Z" },
      { id: "page-reply", from: { id: "page-123" }, created_time: "2026-08-19T08:01:00Z" }
    ] } }, "facebook", pages);
    expect(reply).toEqual({ id: "page-reply", createdAt: new Date("2026-08-19T08:01:00Z") });
  });

  it("detects an Instagram business reply nested under a customer comment", () => {
    const reply = findOwnMetaReply({ replies: { data: [
      { id: "ig-reply", username: "NEGOCIOVIVO", timestamp: "2026-08-19T08:01:00Z" }
    ] } }, "instagram", pages);
    expect(reply?.id).toBe("ig-reply");
  });
});
