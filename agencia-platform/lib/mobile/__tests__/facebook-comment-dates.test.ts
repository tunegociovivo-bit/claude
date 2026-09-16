import { describe, expect, it } from "vitest";
import { commentWithinPeriod, facebookCommentDate } from "@/lib/mobile/facebook-comment-dates";

const reference = Date.parse("2026-09-16T12:00:00Z");
describe("Facebook comment date window", () => {
  it.each(["1 min", "2 h", "hace 3 días", "2 sem", "ayer", "10 de septiembre de 2026"])("includes recent date %s", (label) => {
    expect(commentWithinPeriod(label, 30, reference)).toBe(true);
  });
  it.each(["40 d", "8 sem", "2 meses", "10 de agosto de 2026", "1 año"])("excludes old date %s", (label) => {
    expect(commentWithinPeriod(label, 30, reference)).toBe(false);
  });
  it("treats rounded boundary dates and unknown dates conservatively", () => {
    expect(commentWithinPeriod("30 d", 30, reference)).toBe(false);
    expect(commentWithinPeriod("", 30, reference)).toBe(false);
    expect(facebookCommentDate("31 de febrero de 2026", reference)).toBeNull();
    expect(commentWithinPeriod("17 de septiembre de 2026", 30, reference)).toBe(false);
  });
  it("applies the selected period and infers the previous year for yearless December", () => {
    expect(commentWithinPeriod("10 d", 7, reference)).toBe(false);
    expect(commentWithinPeriod("40 d", 90, reference)).toBe(true);
    expect(facebookCommentDate("31 dic", Date.parse("2026-01-02T12:00:00Z"))).toBe(Date.parse("2025-12-31T00:00:00Z"));
  });
});
