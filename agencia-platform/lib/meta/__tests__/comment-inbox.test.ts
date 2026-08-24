import { describe, expect, it } from "vitest";
import { campaignOptionsForClient, filterMetaCommentInbox } from "../comment-inbox";

const comments = [
  { id: "1", status: "pending", sentiment: "negative", feed: { clientName: "ESAEM Nueva", displayName: "ESAEM", campaignId: "c1", campaignName: "Grado" } },
  { id: "2", status: "pending", sentiment: "neutral", feed: { clientName: "ESAEM Nueva", displayName: "ESAEM", campaignId: "c2", campaignName: "Máster" } },
  { id: "3", status: "replied", sentiment: "positive", feed: { clientName: "Eroski", displayName: null, campaignId: "c3", campaignName: "Franquicias" } }
];

describe("Meta comments inbox filters", () => {
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
