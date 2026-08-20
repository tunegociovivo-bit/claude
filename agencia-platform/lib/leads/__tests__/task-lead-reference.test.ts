import { describe, expect, it } from "vitest";

import { taskLeadReference } from "../task-lead-reference";

describe("task lead conversation reference", () => {
  it("opens the WhatsApp conversation in a commercial handoff task", () => {
    expect(
      taskLeadReference(null, {
        source: "lead-commercial-handoff",
        leadId: "lead-1",
        leadPhone: "688 95 09 56",
      }),
    ).toEqual({ leadId: "lead-1", phone: "688 95 09 56" });
  });

  it("keeps supporting tasks created directly from the leads inbox", () => {
    expect(
      taskLeadReference(null, {
        source: "leads",
        leadId: "lead-2",
        leadPhone: "34600111222",
      }),
    ).toEqual({ leadId: "lead-2", phone: "34600111222" });
  });

  it("prefers live lead metadata when the task provides it", () => {
    expect(
      taskLeadReference(
        { leadId: "live-lead", phone: "34600999888" },
        { source: "lead-commercial-handoff", leadId: "old", leadPhone: "old-phone" },
      ),
    ).toEqual({ leadId: "live-lead", phone: "34600999888" });
  });

  it("does not expose a conversation for unrelated task custom data", () => {
    expect(taskLeadReference(null, { source: "manual", leadPhone: "34600111222" })).toBeNull();
  });
});
