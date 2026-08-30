import { describe, expect, it } from "vitest";
import { recurringDeliverySummary } from "@/lib/invoicing/recurring-presentation";

describe("recurring invoice delivery presentation", () => {
  it("shows the next send date, primary recipient and hidden copies", () => {
    expect(recurringDeliverySummary({
      nextRunAt: "2026-08-31T00:00:00.000Z",
      recipientEmail: "cliente@example.com",
      bccEmails: ["info@negociovivo.com", "control@example.com"]
    })).toEqual({
      date: "31/8/2026",
      recipient: "cliente@example.com",
      bcc: "info@negociovivo.com, control@example.com"
    });
  });

  it("uses clear placeholders when delivery data is missing", () => {
    expect(recurringDeliverySummary({ nextRunAt: null, recipientEmail: null, bccEmails: [] }))
      .toEqual({ date: "—", recipient: "Sin correo configurado", bcc: null });
  });
});
