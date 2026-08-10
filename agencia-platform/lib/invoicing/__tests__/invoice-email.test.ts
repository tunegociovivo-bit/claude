import { describe, expect, it } from "vitest";
import { getInvoiceReminderKey, invoiceRecipient } from "../invoice-email";

describe("invoiceRecipient", () => {
  it("prefers the frozen fiscal snapshot", () => {
    expect(invoiceRecipient({ email: "new@example.com" }, { email: "issued@example.com" })).toBe("issued@example.com");
  });

  it("falls back to the current client email", () => {
    expect(invoiceRecipient({ email: "client@example.com" }, null)).toBe("client@example.com");
  });
});

describe("getInvoiceReminderKey", () => {
  const due = new Date("2026-08-20T12:00:00Z");

  it("plans one reminder three days before maturity", () => {
    expect(getInvoiceReminderKey(due, new Date("2026-08-17T12:00:00Z"))).toBe("DUE_MINUS_3");
  });

  it("plans overdue reminders on days 1, 7 and 15", () => {
    expect(getInvoiceReminderKey(due, new Date("2026-08-21T12:00:00Z"))).toBe("OVERDUE_1");
    expect(getInvoiceReminderKey(due, new Date("2026-08-27T12:00:00Z"))).toBe("OVERDUE_7");
    expect(getInvoiceReminderKey(due, new Date("2026-09-04T12:00:00Z"))).toBe("OVERDUE_15");
  });

  it("does not send outside an exact daily reminder window", () => {
    expect(getInvoiceReminderKey(due, new Date("2026-08-22T12:00:00Z"))).toBeNull();
    expect(getInvoiceReminderKey(null, new Date())).toBeNull();
  });
});
