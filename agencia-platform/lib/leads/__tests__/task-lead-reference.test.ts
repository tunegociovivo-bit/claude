import { describe, expect, it } from "vitest";

import { commercialLeadCustomData, isLeadTaskCustomData, taskLeadReference } from "../task-lead-reference";

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

  it("combines a live phone with the lead id persisted in the task", () => {
    expect(
      taskLeadReference(
        { phone: "+34 688 95 09 56" },
        { source: "lead-commercial-handoff", leadId: "stored-lead", leadPhone: "688950956" },
      ),
    ).toEqual({ leadId: "stored-lead", phone: "+34 688 95 09 56" });
  });

  it("does not expose a conversation for unrelated task custom data", () => {
    expect(taskLeadReference(null, { source: "manual", leadPhone: "34600111222" })).toBeNull();
  });

  it("preserves both inbox and commercial lead metadata when a task is saved", () => {
    expect(isLeadTaskCustomData({ source: "leads" })).toBe(true);
    expect(isLeadTaskCustomData({ source: "lead-commercial-handoff" })).toBe(true);
    expect(isLeadTaskCustomData({ source: "manual" })).toBe(false);
  });

  it("recovers metadata for a commercial task whose custom data was erased", () => {
    expect(commercialLeadCustomData({ id: "lead-1", name: "Cerrajero Tenerife", phone: "603 27 82 03" })).toEqual({
      source: "lead-commercial-handoff",
      leadId: "lead-1",
      leadName: "Cerrajero Tenerife",
      leadPhone: "603 27 82 03",
      leadInboxUrl: "/admin/leads?tab=inbox&phone=603%2027%2082%2003"
    });
  });
});
