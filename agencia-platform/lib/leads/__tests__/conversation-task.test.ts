import { describe, expect, it } from "vitest";
import { conversationTaskWhere } from "../conversation-task";

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
