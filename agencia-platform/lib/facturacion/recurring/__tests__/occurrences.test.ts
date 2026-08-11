/**
 * Slice C — cálculo puro de ocurrencias: periodicidad, meses cortos, bisiestos,
 * recorte de día, fecha de fin, catch-up acotado.
 */
import { describe, it, expect } from "vitest";
import { occurrenceAt, occurrencesBetween, dueOccurrences, nextOccurrence, lastDayOfMonthUTC, occurrenceKey, type RecurrenceSpec } from "../occurrences";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("occurrenceAt — periodicidad + recorte de día", () => {
  it("mensual desde el 15", () => {
    const anchor = d("2026-01-15");
    expect(iso(occurrenceAt(anchor, 0, 1, null))).toBe("2026-01-15");
    expect(iso(occurrenceAt(anchor, 1, 1, null))).toBe("2026-02-15");
    expect(iso(occurrenceAt(anchor, 12, 1, null))).toBe("2027-01-15");
  });
  it("día 31 → recorta a fin de mes corto (feb, abr)", () => {
    const anchor = d("2026-01-31");
    expect(iso(occurrenceAt(anchor, 1, 1, 31))).toBe("2026-02-28"); // 2026 no bisiesto
    expect(iso(occurrenceAt(anchor, 3, 1, 31))).toBe("2026-04-30");
  });
  it("bisiesto: 29-feb en 2028", () => {
    const anchor = d("2028-01-31");
    expect(iso(occurrenceAt(anchor, 1, 1, 31))).toBe("2028-02-29");
    expect(lastDayOfMonthUTC(2028, 1)).toBe(29);
    expect(lastDayOfMonthUTC(2026, 1)).toBe(28);
  });
  it("trimestral y anual", () => {
    const anchor = d("2026-01-10");
    expect(iso(occurrenceAt(anchor, 1, 3, null))).toBe("2026-04-10");
    expect(iso(occurrenceAt(anchor, 1, 12, null))).toBe("2027-01-10");
  });
});

const spec = (o: Partial<RecurrenceSpec> = {}): RecurrenceSpec => ({
  anchorDate: d("2026-01-01"),
  intervalMonths: 1,
  dayOfMonth: 1,
  startDate: null,
  endDate: null,
  nextIssueAt: null,
  ...o
});

describe("occurrencesBetween — rango, cap, endDate", () => {
  it("todas las mensuales de un semestre", () => {
    const occ = occurrencesBetween(spec(), d("2026-01-01"), d("2026-06-30"));
    expect(occ.map(iso)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"]);
  });
  it("respeta endDate de la plantilla", () => {
    const occ = occurrencesBetween(spec({ endDate: d("2026-03-01") }), d("2026-01-01"), d("2026-12-31"));
    expect(occ.map(iso)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
  it("cap acota el número", () => {
    expect(occurrencesBetween(spec(), d("2026-01-01"), d("2030-12-31"), 3)).toHaveLength(3);
  });
});

describe("dueOccurrences — catch-up acotado desde el cursor", () => {
  it("desde nextIssueAt hasta now", () => {
    const occ = dueOccurrences(spec({ nextIssueAt: d("2026-03-01") }), d("2026-05-15"));
    expect(occ.map(iso)).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
  });
  it("acota el catch-up con cap (no reconstruye años)", () => {
    // plantilla mensual muy atrasada: anchor y cursor en 2020, now 2026 → 72
    // ocurrencias posibles, pero el cap las limita a 5 (más antiguas primero).
    const occ = dueOccurrences(spec({ anchorDate: d("2020-01-01"), nextIssueAt: d("2020-01-01") }), d("2026-01-01"), 5);
    expect(occ).toHaveLength(5);
    expect(occ.map(iso)).toEqual(["2020-01-01", "2020-02-01", "2020-03-01", "2020-04-01", "2020-05-01"]);
  });
  it("plantilla terminada (endDate < cursor) → vacío", () => {
    expect(dueOccurrences(spec({ nextIssueAt: d("2026-06-01"), endDate: d("2026-01-01") }), d("2026-07-01"))).toEqual([]);
  });
});

describe("nextOccurrence / occurrenceKey", () => {
  it("primera estrictamente posterior", () => {
    expect(iso(nextOccurrence(spec(), d("2026-03-15"))!)).toBe("2026-04-01");
  });
  it("null si supera endDate", () => {
    expect(nextOccurrence(spec({ endDate: d("2026-02-01") }), d("2026-02-15"))).toBeNull();
  });
  it("occurrenceKey es date-only", () => {
    expect(occurrenceKey(d("2026-04-01"))).toBe("2026-04-01");
  });
});
