/**
 * Contrato FASE 2 · objetivo 1 — índice de conversaciones (cursor seguro).
 * Se testea la lógica PURA: params, cursor, forma/bindings de la SQL agrupada,
 * y el recorte limit+1. La ejecución contra BD se valida aparte (EXPLAIN).
 */
import { describe, it, expect } from "vitest";
import {
  parseConvIndexParams,
  encodeConvCursor,
  decodeConvCursor,
  buildConvIndexQuery,
  buildConvCountQuery,
  toConvIndexResult,
  CONV_INDEX_DEFAULT_LIMIT,
  CONV_INDEX_MAX_LIMIT
} from "../conversation-index";

const sp = (o: Record<string, string>) => new URLSearchParams(o);

describe("parseConvIndexParams", () => {
  it("defaults y cap de limit", () => {
    expect(parseConvIndexParams(sp({})).limit).toBe(CONV_INDEX_DEFAULT_LIMIT);
    expect(parseConvIndexParams(sp({ limit: "9999" })).limit).toBe(CONV_INDEX_MAX_LIMIT);
    expect(parseConvIndexParams(sp({ limit: "0" })).limit).toBe(CONV_INDEX_DEFAULT_LIMIT);
  });
  it("dateFrom y dateTo son INDEPENDIENTES (un 'desde' abierto no se ignora)", () => {
    const onlyFrom = parseConvIndexParams(sp({ dateFrom: "2026-01-01T00:00:00Z" }));
    expect(onlyFrom.dateFrom).toBeInstanceOf(Date);
    expect(onlyFrom.dateTo).toBeNull();
    const onlyTo = parseConvIndexParams(sp({ dateTo: "2026-01-02T00:00:00Z" }));
    expect(onlyTo.dateFrom).toBeNull();
    expect(onlyTo.dateTo).toBeInstanceOf(Date);
    const both = parseConvIndexParams(sp({ dateFrom: "2026-01-01T00:00:00Z", dateTo: "2026-01-02T00:00:00Z" }));
    expect(both.dateFrom).toBeInstanceOf(Date);
    expect(both.dateTo).toBeInstanceOf(Date);
  });
});

describe("cursor opaco", () => {
  it("round-trip y rechazo de basura", () => {
    const c = encodeConvCursor({ lastAt: "2026-08-11T10:00:00.000Z", phone: "34600111222" });
    expect(decodeConvCursor(c)).toEqual({ lastAt: "2026-08-11T10:00:00.000Z", phone: "34600111222" });
    expect(decodeConvCursor(null)).toBeNull();
    expect(decodeConvCursor("###")).toBeNull();
    // sin separador
    expect(decodeConvCursor(Buffer.from("nofecha", "utf8").toString("base64"))).toBeNull();
  });
});

describe("buildConvIndexQuery (SQL parametrizada)", () => {
  it("sin cursor: bindings = [workspaceId, limit+1] y agrupa por conversación", () => {
    const q: any = buildConvIndexQuery("w1", { limit: 30, cursor: null, account: null, dateFrom: null, dateTo: null });
    expect(q.values).toEqual(["w1", 31]);
    expect(q.sql).toMatch(/COALESCE\("phoneNormalized", "fromPhone"\)/);
    expect(q.sql).toMatch(/GROUP BY 1/);
    expect(q.sql).toMatch(/ORDER BY last_at DESC, phone ASC/);
    expect(q.sql).not.toMatch(/last_at </); // sin keyset (ORDER BY usa "last_at DESC")
  });

  it("con cursor: añade keyset (fecha, fecha, phone) y luego limit+1", () => {
    const q: any = buildConvIndexQuery("w1", {
      limit: 30,
      cursor: { lastAt: "2026-08-11T10:00:00.000Z", phone: "34600" },
      account: null,
      dateFrom: null,
      dateTo: null
    });
    // [workspaceId, cursorDate, cursorDate, phone, limit+1]
    expect(q.values).toHaveLength(5);
    expect(q.values[0]).toBe("w1");
    expect(q.values[1]).toBeInstanceOf(Date);
    expect((q.values[1] as Date).toISOString()).toBe("2026-08-11T10:00:00.000Z");
    expect(q.values[3]).toBe("34600");
    expect(q.values[4]).toBe(31);
    expect(q.sql).toMatch(/last_at < \?/);
  });

  it("account default → instanceName IS NULL; account concreto → binding", () => {
    const def: any = buildConvIndexQuery("w1", { limit: 30, cursor: null, account: "__default__", dateFrom: null, dateTo: null });
    expect(def.sql).toMatch(/"instanceName" IS NULL/);
    expect(def.values).toEqual(["w1", 31]);
    const named: any = buildConvIndexQuery("w1", { limit: 30, cursor: null, account: "ZTE-2", dateFrom: null, dateTo: null });
    expect(named.values).toEqual(["w1", "ZTE-2", 31]);
  });

  it("dateFrom solo → añade predicado receivedAt >= (un binding de fecha)", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const q: any = buildConvIndexQuery("w1", { limit: 30, cursor: null, account: null, dateFrom: from, dateTo: null });
    expect(q.values).toEqual(["w1", from, 31]);
    expect(q.sql).toMatch(/"receivedAt" >=/);
    expect(q.sql).not.toMatch(/"receivedAt" </);
  });
});

describe("buildConvCountQuery", () => {
  it("cuenta conversaciones y suma unread con los mismos filtros (sin limit)", () => {
    const q: any = buildConvCountQuery("w1", { limit: 30, cursor: null, account: null, dateFrom: null, dateTo: null });
    expect(q.values).toEqual(["w1"]);
    expect(q.sql).toMatch(/COUNT\(\*\)::int AS total/);
    expect(q.sql).toMatch(/SUM\(unread\), 0\)::int AS "totalUnread"/);
  });
});

describe("toConvIndexResult", () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({
    phone: `p${i}`,
    lastAt: new Date(Date.UTC(2026, 7, 11, 10, 0, 31 - i)),
    unread: i
  }));
  it("recorta la fila centinela y emite nextCursor con la última", () => {
    const r = toConvIndexResult(rows, 30);
    expect(r.items).toHaveLength(30);
    expect(r.nextCursor).not.toBeNull();
    // el cursor codifica la última fila de la página
    expect(decodeConvCursor(r.nextCursor)).toEqual({ lastAt: r.items[29].lastAt, phone: "p29" });
  });
  it("sin fila extra → nextCursor null", () => {
    const r = toConvIndexResult(rows.slice(0, 10), 30);
    expect(r.items).toHaveLength(10);
    expect(r.nextCursor).toBeNull();
  });
});
