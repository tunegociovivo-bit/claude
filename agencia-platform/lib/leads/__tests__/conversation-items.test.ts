import { describe, expect, it } from "vitest";
import { mergeLeadConversationItems, type LeadConversationItem } from "@/lib/leads/conversation-items";

const campaign = (overrides: Partial<LeadConversationItem> = {}): LeadConversationItem => ({
  id: "campaign-1",
  externalMessageId: "wamid.same-message",
  direction: "out",
  body: "Hola, mensaje comercial",
  at: "2026-08-17T09:08:10.000Z",
  instanceName: "sonia8",
  kind: "campaign",
  status: "sent",
  ack: 1,
  ...overrides
});

const phoneEcho = (overrides: Partial<LeadConversationItem> = {}): LeadConversationItem => ({
  id: "inbox-1",
  externalMessageId: "wamid.same-message",
  direction: "out",
  body: "Hola, mensaje comercial",
  at: "2026-08-17T09:08:11.000Z",
  instanceName: "sonia8",
  kind: "inbox",
  ack: 2,
  ...overrides
});

describe("mergeLeadConversationItems", () => {
  it("shows one bubble when campaign and phone history contain the same WhatsApp message", () => {
    const result = mergeLeadConversationItems([campaign(), phoneEcho()]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "campaign", ack: 2, externalMessageId: "wamid.same-message" });
  });

  it("keeps two messages when WhatsApp returned different identifiers", () => {
    const result = mergeLeadConversationItems([
      campaign(),
      phoneEcho({ id: "inbox-2", externalMessageId: "wamid.actual-second-send" })
    ]);

    expect(result).toHaveLength(2);
  });

  it("merges the campaign row with its phone echo when a legacy row has no WhatsApp identifier", () => {
    const result = mergeLeadConversationItems([
      campaign({ externalMessageId: null }),
      phoneEcho()
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "campaign",
      ack: 2,
      externalMessageId: "wamid.same-message"
    });
  });

  it("never merges inbound messages with an outbound campaign message", () => {
    const result = mergeLeadConversationItems([
      campaign(),
      phoneEcho({ direction: "in", id: "inbox-in", externalMessageId: "wamid.same-message" })
    ]);

    expect(result).toHaveLength(2);
  });
});
