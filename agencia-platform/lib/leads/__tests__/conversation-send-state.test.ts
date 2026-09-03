import { describe, expect, it } from "vitest";
import { failPendingReply, hasConfirmedReplyId, visibleConversationItems, whatsappAckLabel, type PendingConversationReply } from "@/lib/leads/conversation-send-state";

const pending: PendingConversationReply = {
  id: "tmp-1",
  direction: "out",
  body: "Mensaje importante",
  at: "2026-09-03T10:00:00.000Z",
  deliveryState: "sending"
};

describe("conversation optimistic reply state", () => {
  it("keeps a failed reply visible and marks it as not sent", () => {
    const failed = failPendingReply([pending], "tmp-1", "WAHA no disponible");
    expect(failed).toEqual([{ ...pending, deliveryState: "failed", deliveryError: "WAHA no disponible" }]);
  });

  it("keeps transient replies visible when polling replaces server messages", () => {
    const server = [{ id: "saved-1", direction: "in" as const, body: "Hola", at: "2026-09-03T09:59:00.000Z" }];
    expect(visibleConversationItems(server, [pending]).map(message => message.id)).toEqual(["saved-1", "tmp-1"]);
  });

  it("explains WhatsApp acknowledgement levels without claiming delivery too early", () => {
    expect(whatsappAckLabel(null)).toBe("Pendiente de confirmación");
    expect(whatsappAckLabel(1)).toBe("Enviado");
    expect(whatsappAckLabel(2)).toBe("Entregado");
    expect(whatsappAckLabel(3)).toBe("Leído");
  });

  it("requires a persisted message id before treating a reply as sent", () => {
    expect(hasConfirmedReplyId({ ok: true })).toBe(false);
    expect(hasConfirmedReplyId({ id: "   " })).toBe(false);
    expect(hasConfirmedReplyId({ id: "saved-1" })).toBe(true);
  });
});
