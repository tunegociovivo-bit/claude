import { describe, expect, it, vi } from "vitest";
import { resolveConversationIdentity } from "../conversation-identity";

describe("resolveConversationIdentity", () => {
  it("une el LID antiguo de la tarea con el numero real reciente por leadId", async () => {
    const findInbox = vi.fn()
      .mockResolvedValueOnce([{ phoneNormalized: "123@lid", fromPhone: "123@lid", leadId: "lead-1" }])
      .mockResolvedValueOnce([
        { phoneNormalized: "123@lid", fromPhone: "123@lid", leadId: "lead-1" },
        { phoneNormalized: "34600111222", fromPhone: "34600111222@c.us", leadId: "lead-1" }
      ]);
    const findMeta = vi.fn().mockResolvedValue([{ phone: "123@lid", realPhone: "34600111222" }]);
    const result = await resolveConversationIdentity({
      leadInboxMessage: { findMany: findInbox }, leadConversationMeta: { findMany: findMeta }
    } as any, "w1", "123@lid");
    expect(result.leadIds).toEqual(["lead-1"]);
    expect(result.phones).toEqual(expect.arrayContaining(["123@lid", "34600111222", "34600111222@c.us"]));
  });

  it("mantiene todas las consultas aisladas por workspace", async () => {
    const findInbox = vi.fn().mockResolvedValue([]);
    const findMeta = vi.fn().mockResolvedValue([]);
    await resolveConversationIdentity({
      leadInboxMessage: { findMany: findInbox }, leadConversationMeta: { findMany: findMeta }
    } as any, "workspace-seguro", "34600111222");
    expect(findInbox).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace-seguro" }) }));
    expect(findMeta).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace-seguro" }) }));
  });

  it("usa leadId explicito aunque el identificador antiguo ya no tenga mensajes", async () => {
    const findInbox = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      { phoneNormalized: "34600999888", fromPhone: "34600999888", leadId: "lead-explicit" }
    ]);
    const findMeta = vi.fn().mockResolvedValue([]);
    const result = await resolveConversationIdentity({
      leadInboxMessage: { findMany: findInbox }, leadConversationMeta: { findMany: findMeta }
    } as any, "w1", "antiguo", "lead-explicit");
    expect(result.leadIds).toContain("lead-explicit");
    expect(result.phones).toContain("34600999888");
  });
});
