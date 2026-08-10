import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resendDeliveryStatus, verifyResendWebhook } from "../resend-webhook";

describe("verifyResendWebhook", () => {
  const secret = `whsec_${Buffer.from("test-secret").toString("base64")}`;
  const payload = JSON.stringify({ type: "email.delivered" });
  const id = "evt_test";
  const timestamp = "1786348800";
  const signature = `v1,${createHmac("sha256", Buffer.from("test-secret")).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;

  it("accepts a valid, recent Svix signature", () => {
    expect(verifyResendWebhook({ payload, id, timestamp, signature, secret, now: new Date("2026-08-10T08:00:00Z") })).toBe(true);
  });

  it("rejects tampered or replayed payloads", () => {
    expect(verifyResendWebhook({ payload: payload + " ", id, timestamp, signature, secret, now: new Date("2026-08-10T08:00:00Z") })).toBe(false);
    expect(verifyResendWebhook({ payload, id, timestamp, signature, secret, now: new Date("2026-08-10T09:00:00Z") })).toBe(false);
  });
});

it("maps delivery events to auditable statuses", () => {
  expect(resendDeliveryStatus("email.delivered")).toBe("DELIVERED");
  expect(resendDeliveryStatus("email.bounced")).toBe("BOUNCED");
  expect(resendDeliveryStatus("domain.updated")).toBeNull();
});
