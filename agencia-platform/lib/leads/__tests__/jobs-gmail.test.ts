import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaceFindUnique: vi.fn(),
  decryptSecret: vi.fn(() => "refresh-token")
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { workspace: { findUnique: mocks.workspaceFindUnique } }
}));
vi.mock("@/lib/ai/crypto", () => ({ decryptSecret: mocks.decryptSecret }));

import { fetchPendingGoogleMessages, markGoogleMessagesProcessed } from "../sources/jobs-gmail";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Gmail job alert cursor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.workspaceFindUnique.mockResolvedValue({
      settings: { integrations: { googleJobsInbox: { refreshTokenEncrypted: "encrypted" } } }
    });
  });

  it("finds recent job alerts even when Gmail already considers them read and returns one bounded batch", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "access" });
      if (url.endsWith("/labels")) {
        return json({ labels: [{ id: "Label_42", name: "NVLeadsProProcessed" }] });
      }
      if (url.includes("/messages?")) {
        return json({ messages: [{ id: "message-1" }, { id: "message-2" }] });
      }
      if (url.includes("/messages/message-1?format=raw")) {
        return json({ raw: Buffer.from("first").toString("base64url") });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const messages = await fetchPendingGoogleMessages("workspace-1");

    expect(messages).toEqual([{ id: "message-1", raw: Buffer.from("first") }]);
    const listUrl = String(fetchMock.mock.calls.find(([url]) => String(url).includes("/messages?"))?.[0]);
    const query = new URL(listUrl).searchParams.get("q") ?? "";
    expect(query).toContain("newer_than:14d");
    expect(query).toContain("-label:NVLeadsProProcessed");
    expect(query).toContain("from:infojobs.net");
    expect(query).not.toContain("is:unread");
    expect(new URL(listUrl).searchParams.get("maxResults")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("message-2?format=raw"),
      expect.anything()
    );
  });

  it("marks imported messages with an internal label without changing their read state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "access" });
      if (url.endsWith("/labels") && !init?.method) {
        return json({ labels: [{ id: "Label_42", name: "NVLeadsProProcessed" }] });
      }
      if (url.includes("/messages/message-1/modify")) return json({ id: "message-1" });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await markGoogleMessagesProcessed("workspace-1", ["message-1"]);

    const modifyCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/modify"));
    expect(modifyCall).toBeDefined();
    expect(JSON.parse(String(modifyCall?.[1]?.body))).toEqual({ addLabelIds: ["Label_42"] });
  });
});
