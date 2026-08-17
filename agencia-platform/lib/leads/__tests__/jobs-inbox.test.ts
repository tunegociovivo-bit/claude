import { describe, expect, it } from "vitest";
import { isJobAlertSender } from "../sources/jobs-inbox";

describe("isJobAlertSender", () => {
  it("accepts Google Alerts and supported job portals", () => {
    expect(isJobAlertSender("Google Alerts <googlealerts-noreply@google.com>")).toBe(true);
    expect(isJobAlertSender("jobs-noreply@linkedin.com")).toBe(true);
  });

  it("does not accept arbitrary Google or unrelated mail", () => {
    expect(isJobAlertSender("someone@google.com")).toBe(false);
    expect(isJobAlertSender("newsletter@example.com")).toBe(false);
  });
});
