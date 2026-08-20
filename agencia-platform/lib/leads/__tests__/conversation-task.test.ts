import { describe, expect, it, vi } from "vitest";
import { acquireConversationTaskLock, conversationTaskWhere } from "../conversation-task";

describe("conversationTaskWhere", () => {
  it("vincula la tarea al workspace y teléfono exactos de la conversación", () => {
    expect(conversationTaskWhere("ws-1", ["34600111222"], [])).toEqual({
      workspaceId: "ws-1",
      deletedAt: null,
      AND: [
        { customData: { path: ["source"], equals: "leads" } },
        { OR: [{ customData: { path: ["leadPhone"], equals: "34600111222" } }] }
      ]
    });
  });

  it("reconoce teléfono real, LID y leadId como alias de la misma conversación", () => {
    const where = conversationTaskWhere("ws-1", [" 34600111222 ", "123@lid"], ["lead-1"]) as any;
    expect(where.AND[1].OR).toEqual([
      { customData: { path: ["leadPhone"], equals: "34600111222" } },
      { customData: { path: ["leadPhone"], equals: "123@lid" } },
      { customData: { path: ["leadId"], equals: "lead-1" } }
    ]);
  });
});

describe("acquireConversationTaskLock", () => {
  it("usa executeRaw para que Prisma no intente deserializar el void de PostgreSQL", async () => {
    const executeRaw = vi.fn(async () => 0);
    const queryRaw = vi.fn(async () => {
      throw new Error("Failed to deserialize column of type 'void'");
    });

    await acquireConversationTaskLock(
      { $executeRaw: executeRaw, $queryRaw: queryRaw } as any,
      "workspace-1:lead:lead-1"
    );

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
