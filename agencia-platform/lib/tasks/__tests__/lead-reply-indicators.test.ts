import { describe, expect, it } from "vitest";
import { buildUnreadLeadReplyCounts } from "../lead-reply-indicators";

describe("buildUnreadLeadReplyCounts", () => {
  const tasks = [
    { id: "task-lead", customData: { source: "leads", leadId: "lead-1", leadPhone: "+34 600 111 222" } },
    { id: "task-phone", customData: { source: "lead-commercial-handoff", leadPhone: "34600333444" } },
    { id: "task-normal", customData: null }
  ];

  it("marks lead tasks with unread inbound replies by lead id or normalized phone", () => {
    const counts = buildUnreadLeadReplyCounts(tasks, [
      { leadId: "lead-1", phoneNormalized: "34600111222", fromPhone: "34600111222" },
      { leadId: null, phoneNormalized: null, fromPhone: "+34 600 333 444@c.us" }
    ]);

    expect(counts).toEqual({ "task-lead": 1, "task-phone": 1 });
  });

  it("counts several new replies and ignores messages from unrelated leads", () => {
    const counts = buildUnreadLeadReplyCounts(tasks, [
      { leadId: "lead-1", phoneNormalized: "34600111222", fromPhone: "34600111222" },
      { leadId: "lead-1", phoneNormalized: "34600111222", fromPhone: "34600111222" },
      { leadId: "other", phoneNormalized: "34600999999", fromPhone: "34600999999" }
    ]);

    expect(counts).toEqual({ "task-lead": 2 });
  });
});
