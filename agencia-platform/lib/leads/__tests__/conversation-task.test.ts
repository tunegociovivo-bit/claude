import { describe, expect, it } from "vitest";
import { conversationTaskWhere } from "../conversation-task";

describe("conversationTaskWhere", () => {
  it("vincula la tarea al workspace y teléfono exactos de la conversación", () => {
    expect(conversationTaskWhere("ws-1", "34600111222")).toEqual({
      workspaceId: "ws-1",
      deletedAt: null,
      AND: [
        { customData: { path: ["source"], equals: "leads" } },
        { customData: { path: ["leadPhone"], equals: "34600111222" } }
      ]
    });
  });

  it("normaliza espacios para no perder el vínculo tras recargar", () => {
    expect((conversationTaskWhere("ws-1", " 34600111222 ") as any).AND[1]
      .customData.equals).toBe("34600111222");
  });
});
