import { describe, expect, it } from "vitest";
import { recurringDeliverySummary, upcomingRecurringDeliveries } from "@/lib/invoicing/recurring-presentation";

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

  it("does not break the list for an invalid legacy date and hides duplicate BCC entries", () => {
    expect(recurringDeliverySummary({
      nextRunAt: "not-a-date",
      recipientEmail: "cliente@example.com",
      bccEmails: ["Control@Example.com", " control@example.com "]
    })).toEqual({ date: "Fecha inválida", recipient: "cliente@example.com", bcc: "control@example.com" });
  });

  it("selects the nearest recurring deliveries for the main billing dashboard", () => {
    const deliveries = upcomingRecurringDeliveries([
      { id: "later", contactName: "Cliente B", nextRunAt: "2026-09-05T00:00:00.000Z", recipientEmail: "b@example.com", bccEmails: [], status: "active", sendAutomatically: true },
      { id: "paused", contactName: "Cliente pausado", nextRunAt: "2026-08-31T00:00:00.000Z", recipientEmail: "paused@example.com", bccEmails: [], status: "paused", sendAutomatically: true },
      { id: "first", contactName: "Cliente A", nextRunAt: "2026-09-01T00:00:00.000Z", recipientEmail: "a@example.com", bccEmails: ["info@negociovivo.com"], status: "active", sendAutomatically: true }
    ], 2);

    expect(deliveries.map((delivery) => delivery.id)).toEqual(["first", "later"]);
    expect(deliveries[0]).toMatchObject({ date: "1/9/2026", recipient: "a@example.com", bcc: "info@negociovivo.com" });
  });
});
