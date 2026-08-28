import { describe, expect, it } from "vitest";
import {
  addInvoicePaymentDays,
  addInvoiceMonths,
  addInvoiceInterval,
  automationStatus,
  formatInvoiceNumberPreview,
  invoiceRecipientEmail,
  invoiceTaxLabel,
  recurringOccurrenceSchedule,
} from "../invoice-form";

describe("invoice form defaults", () => {
  it("sets the due date 30 calendar days after the issue date", () => {
    expect(addInvoicePaymentDays("2026-08-28", 30)).toBe("2026-09-27");
  });

  it("handles month and year changes without timezone drift", () => {
    expect(addInvoicePaymentDays("2026-12-15", 30)).toBe("2027-01-14");
  });

  it("schedules the first recurring run one interval after creation", () => {
    expect(addInvoiceMonths("2026-08-31", 1)).toBe("2026-09-30");
  });

  it.each([
    ["2026-08-28", "DAYS", 10, "2026-09-07"],
    ["2026-08-31", "MONTHS", 1, "2026-09-30"],
    ["2024-02-29", "YEARS", 1, "2025-02-28"],
  ] as const)("supports recurring invoices by %s", (date, unit, every, expected) => {
    expect(addInvoiceInterval(date, unit, every)).toBe(expected);
  });
});

describe("recurring invoice catch-up", () => {
  it("returns every missed daily occurrence instead of silently skipping invoices", () => {
    const schedule = recurringOccurrenceSchedule("2026-08-01", "2026-08-04", "DAYS", 1);
    expect(schedule.dueDates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]);
    expect(schedule.nextRunAt).toBe("2026-08-05");
  });

  it("keeps the issue year of an overdue occurrence", () => {
    const schedule = recurringOccurrenceSchedule("2026-12-31", "2027-01-02", "YEARS", 1);
    expect(schedule.dueDates[0]?.slice(0, 4)).toBe("2026");
  });
});

describe("automatic invoice delivery", () => {
  it("uses the email frozen in the client snapshot", () => {
    expect(invoiceRecipientEmail({ email: " facturas@cliente.es " })).toBe("facturas@cliente.es");
  });

  it("prefers the client's designated billing email", () => {
    expect(invoiceRecipientEmail({ email: "general@cliente.es", billingEmail: "facturas@cliente.es" })).toBe("facturas@cliente.es");
  });

  it("refuses to mark a delivery when the client has no email", () => {
    expect(() => invoiceRecipientEmail({ email: null })).toThrow(/email/i);
  });
});

describe("invoice tax labels", () => {
  it("shows zero tax without calling it IVA", () => {
    expect(invoiceTaxLabel(0)).toBe("0% (sin IVA)");
  });

  it("keeps IVA for taxable lines", () => {
    expect(invoiceTaxLabel(21)).toBe("IVA 21%");
  });
});

describe("automatic invoice workflow", () => {
  it.each([
    ["DRAFT", "DRAFT"],
    ["APPROVE", "ISSUED"],
    ["SEND", "SENT"],
  ] as const)("maps %s to %s", (workflow, status) => {
    expect(automationStatus(workflow)).toBe(status);
  });
});

describe("invoice number preview", () => {
  it("shows the next number using the legal series and year", () => {
    expect(formatInvoiceNumberPreview("FAC", 2026, 44)).toBe("FAC-2026-0044");
  });
});
