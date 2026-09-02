import { describe, expect, it } from "vitest";
import { getPreviousMonthPeriod, getRunHealth, shouldRunMonthlySchedule, validateRecipients } from "@/lib/accountancy-invoices/domain";

describe("accountancy invoice automation", () => {
  it("builds the complete previous calendar month", () => {
    expect(getPreviousMonthPeriod(new Date("2026-09-02T06:30:00.000Z"), "Europe/Madrid")).toEqual({ key: "2026-08", from: "2026-08-01", to: "2026-08-31" });
  });

  it("only schedules once on the configured local day and time", () => {
    const config = { dayOfMonth: 2, time: "08:30", timezone: "Europe/Madrid" };
    expect(shouldRunMonthlySchedule(new Date("2026-09-02T06:30:20.000Z"), config, null)).toBe(true);
    expect(shouldRunMonthlySchedule(new Date("2026-09-02T06:44:00.000Z"), config, "2026-09")).toBe(false);
    expect(shouldRunMonthlySchedule(new Date("2026-09-03T06:30:00.000Z"), config, null)).toBe(false);
  });

  it("marks partial and failed downloads prominently", () => {
    expect(getRunHealth([{ status: "DOWNLOADED" }, { status: "DOWNLOADED" }])).toBe("SUCCESS");
    expect(getRunHealth([{ status: "DOWNLOADED" }, { status: "FAILED" }])).toBe("PARTIAL");
    expect(getRunHealth([{ status: "FAILED" }, { status: "FAILED" }])).toBe("FAILED");
  });

  it("normalizes and validates one or more recipient emails", () => {
    expect(validateRecipients(" info@negociovivo.com, gestoria@example.com ")).toEqual(["info@negociovivo.com", "gestoria@example.com"]);
    expect(() => validateRecipients("correo-invalido")).toThrow("Correo no válido");
  });
});
