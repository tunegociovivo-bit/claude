import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: { bubuiCustomer: {}, bubuiChallengeParticipant: {} } }));

import { POST } from "@/app/api/bubui/customer/[id]/challenge-contact/route";

describe("challenge contact endpoint", () => {
  it("rejects anonymous calls even while legacy customer auth is in lazy mode", async () => {
    const response = await POST(
      new Request("https://bubui.app/api/bubui/customer/customer-1/challenge-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId: "welcome-1", channel: "qr" })
      }),
      { params: { id: "customer-1" } }
    );
    expect(response.status).toBe(401);
  });
});
