import { describe, expect, it } from "vitest";
import {
  addInvoicePaymentDays,
  addInvoiceMonths,
  automationStatus,
  formatInvoiceNumberPreview,
  invoiceRecipientEmail,
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
});

describe("automatic invoice delivery", () => {
  it("uses the email frozen in the client snapshot", () => {
    expect(invoiceRecipientEmail({ email: " facturas@cliente.es " })).toBe("facturas@cliente.es");
  });

  it("refuses to mark a delivery when the client has no email", () => {
    expect(() => invoiceRecipientEmail({ email: null })).toThrow(/email/i);
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
