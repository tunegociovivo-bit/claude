import { describe, expect, it } from "vitest";
import { extractWahaAck, shouldReplaceWahaAck } from "@/lib/leads/waha";

describe("WAHA acknowledgement parsing", () => {
  it("reads numeric acknowledgement from current and nested responses", () => {
    expect(extractWahaAck({ ack: 2 })).toBe(2);
    expect(extractWahaAck({ payload: { ack: 3 } })).toBe(3);
    expect(extractWahaAck({ _data: { ack: 1 } })).toBe(1);
  });

  it("maps acknowledgement names without claiming delivery for SERVER", () => {
    expect(extractWahaAck({ ackName: "SERVER" })).toBe(1);
    expect(extractWahaAck({ ackName: "DEVICE" })).toBe(2);
    expect(extractWahaAck({ ackName: "READ" })).toBe(3);
    expect(extractWahaAck({ ackName: "ERROR" })).toBe(-1);
  });

  it("returns null when the provider gives no usable acknowledgement", () => {
    expect(extractWahaAck({ id: "message-id" })).toBeNull();
    expect(extractWahaAck(null)).toBeNull();
  });

  it("records errors while preserving evidence of delivery", () => {
    expect(shouldReplaceWahaAck(null, -1)).toBe(true);
    expect(shouldReplaceWahaAck(1, -1)).toBe(true);
    expect(shouldReplaceWahaAck(2, -1)).toBe(false);
    expect(shouldReplaceWahaAck(2, 3)).toBe(true);
    expect(shouldReplaceWahaAck(3, 1)).toBe(false);
  });
});
