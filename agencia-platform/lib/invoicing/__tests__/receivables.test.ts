import { describe, expect, it } from "vitest";
import { buildReceivablesSummary } from "../receivables";

describe("buildReceivablesSummary", () => {
  const now = new Date("2026-08-09T12:00:00Z");

  it("separates collected, overdue, due soon and drafts", () => {
    const summary = buildReceivablesSummary([
      { type: "NORMAL", status: "ISSUED", totalCents: 12_100, paidCents: 2_100, issueDate: now, dueDate: "2026-08-01" },
      { type: "NORMAL", status: "ISSUED", totalCents: 5_000, paidCents: 0, issueDate: now, dueDate: "2026-08-14" },
      { type: "NORMAL", status: "PAID", totalCents: 8_000, paidCents: 8_000, issueDate: now, dueDate: "2026-08-05" },
      { type: "NORMAL", status: "DRAFT", totalCents: 3_000, paidCents: 0, issueDate: now, dueDate: null },
      { type: "PRESUPUESTO", status: "ACCEPTED", totalCents: 99_000, paidCents: 0, issueDate: now, dueDate: null }
    ], now);

    expect(summary).toMatchObject({
      issuedCents: 25_100,
      collectedCents: 10_100,
      outstandingCents: 15_000,
      overdueCents: 10_000,
      dueSoonCents: 5_000,
      draftCents: 3_000,
      documentCount: 4,
      overdueCount: 1,
      dueSoonCount: 1
    });
  });

  it("never reports a negative outstanding balance", () => {
    const summary = buildReceivablesSummary([
      { type: "NORMAL", status: "PAID", totalCents: 1_000, paidCents: 1_500, issueDate: now, dueDate: "2026-08-01" }
    ], now);
    expect(summary.outstandingCents).toBe(0);
    expect(summary.collectedCents).toBe(1_000);
  });
});
