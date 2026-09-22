import { describe, expect, it } from "vitest";
import { extractMentionTokens, resolveMentions } from "../mentions";

const users = [
  { id: "u1", email: "aitor@negociovivo.com", name: "Aitor Comercial" },
  { id: "u2", email: "paula@negociovivo.com", name: "Paula García" },
  { id: "u3", email: "david.rios@negociovivo.com", name: "David Ríos NV" }
];

describe("mentions", () => {
  it("resolves workers by visible name, accents and compact names", () => {
    const tokens = extractMentionTokens("Revisar con @Aitor, @paula.garcia y @davidrios");

    expect(resolveMentions(tokens, users).map((user) => user.id)).toEqual(["u1", "u2", "u3"]);
  });

  it("keeps resolving legacy email handles", () => {
    const tokens = extractMentionTokens("Avisar a @aitor y @david.rios");

    expect(resolveMentions(tokens, users).map((user) => user.id)).toEqual(["u1", "u3"]);
  });
});
